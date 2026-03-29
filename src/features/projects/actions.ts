"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/src/lib/db";
import { requireSession } from "@/src/lib/session";
import { projectInputSchema } from "@/src/lib/validation";
import { toSlug } from "@/src/lib/utils";

function asOptionalString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function createProjectAction(formData: FormData) {
  const session = await requireSession();
  const parsed = projectInputSchema.parse({
    name: formData.get("name"),
    description: asOptionalString(formData.get("description")),
  });

  const baseSlug = toSlug(parsed.name);
  let slug = baseSlug;
  let counter = 2;

  while (await prisma.appProject.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  const project = await prisma.appProject.create({
    data: {
      ownerId: session.user.id,
      slug,
      name: parsed.name,
      description: parsed.description || null,
    },
  });

  redirect(`/builder/apps/${project.slug}`);
}

export async function updateProjectAction(formData: FormData) {
  const session = await requireSession();
  const projectId = String(formData.get("projectId"));
  const parsed = projectInputSchema.parse({
    name: formData.get("name"),
    description: asOptionalString(formData.get("description")),
  });

  const project = await prisma.appProject.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, ownerId: true },
  });

  if (!project || project.ownerId !== session.user.id) {
    throw new Error("Project not found.");
  }

  await prisma.appProject.update({
    where: { id: project.id },
    data: {
      name: parsed.name,
      description: parsed.description || null,
    },
  });

  revalidatePath(`/builder/apps/${project.slug}`);
}

export async function deleteProjectAction(formData: FormData) {
  const session = await requireSession();
  const projectId = String(formData.get("projectId"));
  const confirmation = asOptionalString(formData.get("confirmation"));

  const project = await prisma.appProject.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, name: true, ownerId: true },
  });

  if (!project || project.ownerId !== session.user.id) {
    throw new Error("Project not found.");
  }

  if (confirmation !== project.name) {
    redirect(`/builder/apps/${project.slug}?deleteError=confirmation`);
  }

  await prisma.appProject.delete({
    where: { id: project.id },
  });

  revalidatePath("/builder");
  redirect("/builder");
}

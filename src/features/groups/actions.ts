"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/src/lib/db";
import { requireSession } from "@/src/lib/session";

export async function createTesterGroupAction(formData: FormData) {
  const session = await requireSession();
  const projectId = String(formData.get("projectId"));
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const projectSlug = String(formData.get("projectSlug"));

  if (!name) {
    throw new Error("Group name is required.");
  }

  const project = await prisma.appProject.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });

  if (!project || project.ownerId !== session.user.id) {
    throw new Error("Project not found.");
  }

  await prisma.testerGroup.create({
    data: {
      projectId,
      name,
      description: description || null,
    },
  });

  revalidatePath(`/builder/apps/${projectSlug}/groups`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/src/lib/db";
import { createProjectWithinQuota } from "@/src/lib/project-quota";
import { requireBuilderSession } from "@/src/lib/session";
import { projectInputSchema } from "@/src/lib/validation";

function asOptionalString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function createProjectAction(formData: FormData) {
  const session = await requireBuilderSession();
  const parsed = projectInputSchema.parse({
    name: formData.get("name"),
    description: asOptionalString(formData.get("description")),
  });

  const project = await createProjectWithinQuota({
    userId: session.user.id,
    name: parsed.name,
    description: parsed.description || null,
  });

  redirect(`/builder/apps/${project.slug}`);
}

export async function updateProjectAction(formData: FormData) {
  const session = await requireBuilderSession();
  const projectId = String(formData.get("projectId"));
  const parsed = projectInputSchema.parse({
    name: formData.get("name"),
    description: asOptionalString(formData.get("description")),
  });

  const project = await prisma.appProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, slug: true, ownerId: true },
  });

  if (!project || project.ownerId !== session.user.id) {
    throw new Error("Project not found.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.appProject.update({
      where: { id: project.id },
      data: { name: parsed.name, description: parsed.description || null },
    });
    await tx.auditLog.create({
      data: { actorUserId: session.user.id, action: "project.updated", targetType: "AppProject", targetId: project.id },
    });
  });

  revalidatePath(`/builder/apps/${project.slug}`);
}

export async function deleteProjectAction(formData: FormData) {
  const session = await requireBuilderSession();
  const projectId = String(formData.get("projectId"));
  const confirmation = asOptionalString(formData.get("confirmation"));

  const project = await prisma.appProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      ownerId: true,
      releases: { select: { id: true, buildAsset: { select: { storageKey: true } } } },
    },
  });

  if (!project || project.ownerId !== session.user.id) {
    throw new Error("Project not found.");
  }

  if (confirmation !== project.name) {
    redirect(`/builder/apps/${project.slug}?deleteError=confirmation`);
  }

  const deletedAt = new Date();
  const purgeAfter = new Date(deletedAt.getTime() + 7 * 24 * 60 * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.release.updateMany({ where: { projectId: project.id }, data: { deletedAt, purgeAfter } });
    await tx.appProject.update({ where: { id: project.id }, data: { deletedAt, purgeAfter } });
    for (const release of project.releases) {
      if (!release.buildAsset) continue;
      await tx.storageDeletionTask.upsert({
        where: { storageKey: release.buildAsset.storageKey },
        create: {
          storageKey: release.buildAsset.storageKey,
          resourceType: "Release",
          resourceId: release.id,
          scheduledFor: purgeAfter,
        },
        update: { status: "PENDING", scheduledFor: purgeAfter, lastError: null },
      });
    }
    await tx.auditLog.create({
      data: { actorUserId: session.user.id, action: "project.trashed", targetType: "AppProject", targetId: project.id },
    });
  });

  revalidatePath("/builder");
  redirect("/builder");
}

export async function restoreProjectAction(formData: FormData) {
  const session = await requireBuilderSession();
  const projectId = String(formData.get("projectId"));
  const project = await prisma.appProject.findFirst({
    where: { id: projectId, ownerId: session.user.id, deletedAt: { not: null } },
    include: { releases: { include: { buildAsset: true } } },
  });
  if (!project) throw new Error("Project not found in trash.");
  if (project.purgeAfter && project.purgeAfter <= new Date()) throw new Error("This project is already eligible for permanent purge.");

  await prisma.$transaction(async (tx) => {
    const storageKeys = project.releases.flatMap((release) => release.buildAsset?.storageKey ?? []);
    if (storageKeys.length) {
      const removedTasks = await tx.storageDeletionTask.deleteMany({
        where: { storageKey: { in: storageKeys }, status: { in: ["PENDING", "FAILED"] } },
      });
      if (removedTasks.count !== storageKeys.length) {
        throw new Error("Cleanup has already started; this project can no longer be restored.");
      }
    }
    await tx.appProject.update({ where: { id: project.id }, data: { deletedAt: null, purgeAfter: null } });
    await tx.release.updateMany({ where: { projectId: project.id }, data: { deletedAt: null, purgeAfter: null } });
    await tx.auditLog.create({
      data: { actorUserId: session.user.id, action: "project.restored", targetType: "AppProject", targetId: project.id },
    });
  });
  revalidatePath("/builder");
}

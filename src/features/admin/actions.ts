"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/src/lib/db";
import { requireAdminSession } from "@/src/lib/session";
import { deleteObject } from "@/src/lib/storage/s3";

export async function setBuilderStatusAction(formData: FormData) {
  const admin = await requireAdminSession();
  const profileId = String(formData.get("profileId"));
  const status = formData.get("status") === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
  const target = await prisma.builderProfile.findUnique({ where: { id: profileId } });
  if (!target) throw new Error("Builder profile not found.");
  if (target.userId === admin.user.id && status === "SUSPENDED") {
    throw new Error("Administrators cannot suspend their own account.");
  }
  const profile = await prisma.builderProfile.update({ where: { id: profileId }, data: { status } });
  await prisma.auditLog.create({ data: { actorUserId: admin.user.id, action: `builder.${status.toLowerCase()}`, targetType: "BuilderProfile", targetId: profile.id } });
  revalidatePath("/admin");
}

export async function updateBuilderQuotaAction(formData: FormData) {
  const admin = await requireAdminSession();
  const profileId = String(formData.get("profileId"));
  const maxProjects = Number(formData.get("maxProjects"));
  const maxStoredReleases = Number(formData.get("maxStoredReleases"));
  const maxStorageMiB = Number(formData.get("maxStorageMiB"));
  if (![maxProjects, maxStoredReleases, maxStorageMiB].every(Number.isSafeInteger)) throw new Error("Quota values must be integers.");
  if (maxProjects < 0 || maxProjects > 100 || maxStoredReleases < 0 || maxStoredReleases > 1_000 || maxStorageMiB < 0 || maxStorageMiB > 102_400) throw new Error("Quota value outside the allowed admin range.");
  await prisma.builderProfile.update({
    where: { id: profileId },
    data: { maxProjects, maxStoredReleases, maxStorageBytes: BigInt(maxStorageMiB) * 1024n * 1024n },
  });
  await prisma.auditLog.create({ data: { actorUserId: admin.user.id, action: "builder.quota_updated", targetType: "BuilderProfile", targetId: profileId, metadataJson: { maxProjects, maxStoredReleases, maxStorageMiB } } });
  revalidatePath("/admin");
}

export async function purgeStorageTaskAction(formData: FormData) {
  const admin = await requireAdminSession();
  if (String(formData.get("confirmation")) !== "PURGE") throw new Error("Type PURGE to confirm permanent deletion.");
  const taskId = String(formData.get("taskId"));
  const task = await prisma.$transaction(async (tx) => {
    const candidate = await tx.storageDeletionTask.findUnique({ where: { id: taskId } });
    if (!candidate || !["PENDING", "FAILED"].includes(candidate.status)) {
      throw new Error("Deletion task is unavailable or already processing.");
    }

    if (candidate.resourceType === "Release") {
      const release = await tx.release.findUnique({ where: { id: candidate.resourceId }, select: { deletedAt: true } });
      if (!release?.deletedAt) throw new Error("Only trashed releases can be purged.");
    }

    const claimed = await tx.storageDeletionTask.updateMany({
      where: { id: candidate.id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null },
    });
    if (!claimed.count) throw new Error("Deletion task is already processing.");
    return candidate;
  });

  try {
    await deleteObject(task.storageKey);
    await prisma.$transaction(async (tx) => {
      const completedTask = await tx.storageDeletionTask.updateMany({
        where: { id: task.id, status: "PROCESSING", completedAt: null },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (!completedTask.count) throw new Error("Deletion task state changed unexpectedly.");

      if (task.resourceType === "Release") {
        const release = await tx.release.findUnique({ where: { id: task.resourceId }, include: { buildAsset: true, project: true } });
        if (!release?.deletedAt) throw new Error("Only trashed releases can be purged.");
        if (release.buildAsset) await tx.builderProfile.update({ where: { userId: release.project.ownerId }, data: { usedStorageBytes: { decrement: release.buildAsset.fileSizeBytes } } });
        await tx.release.delete({ where: { id: release.id } });
      } else if (task.resourceType === "UploadSession") {
        await tx.releaseUploadSession.deleteMany({ where: { id: task.resourceId, completedAt: null } });
      }
      await tx.auditLog.create({ data: { actorUserId: admin.user.id, action: "storage.purged_immediately", targetType: task.resourceType, targetId: task.resourceId, metadataJson: { storageKey: task.storageKey } } });
    });
  } catch (error) {
    await prisma.storageDeletionTask.updateMany({
      where: { id: task.id, status: "PROCESSING", completedAt: null },
      data: {
        status: "FAILED",
        lastError: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown storage deletion error",
      },
    });
    throw error;
  }
  revalidatePath("/admin");
}

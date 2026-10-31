"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/src/lib/db";
import { requireAdminSession } from "@/src/lib/session";
import { deleteObject } from "@/src/lib/storage/s3";
import { assertUploadDeletionAllowed, settleUploadReservation, uploadTaskTypes } from "@/src/lib/storage/cleanup-uploads";

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
  const maxApkMiB = Number(formData.get("maxApkMiB"));
  const maxStorageMiB = Number(formData.get("maxStorageMiB"));
  if (![maxProjects, maxStoredReleases, maxApkMiB, maxStorageMiB].every(Number.isSafeInteger)) throw new Error("Quota values must be integers.");
  if (maxProjects < 0 || maxProjects > 100 || maxStoredReleases < 0 || maxStoredReleases > 1_000 || maxApkMiB < 0 || maxApkMiB > 5_120 || maxStorageMiB < 0 || maxStorageMiB > 102_400) throw new Error("Quota value outside the allowed admin range.");
  if (maxApkMiB > maxStorageMiB) throw new Error("The per-APK limit cannot exceed the total storage quota.");
  await prisma.builderProfile.update({
    where: { id: profileId },
    data: {
      maxProjects,
      maxStoredReleases,
      maxApkBytes: BigInt(maxApkMiB) * 1024n * 1024n,
      maxStorageBytes: BigInt(maxStorageMiB) * 1024n * 1024n,
    },
  });
  await prisma.auditLog.create({ data: { actorUserId: admin.user.id, action: "builder.quota_updated", targetType: "BuilderProfile", targetId: profileId, metadataJson: { maxProjects, maxStoredReleases, maxApkMiB, maxStorageMiB } } });
  revalidatePath("/admin");
}

export async function purgeStorageTaskAction(formData: FormData) {
  const admin = await requireAdminSession();
  if (String(formData.get("confirmation")) !== "PURGE") throw new Error("Type PURGE to confirm permanent deletion.");
  const taskId = String(formData.get("taskId"));
  const { task, lease } = await prisma.$transaction(async (tx) => {
    const candidate = await tx.storageDeletionTask.findUnique({ where: { id: taskId } });
    if (!candidate || candidate.completedAt || !["PENDING", "FAILED"].includes(candidate.status)) {
      throw new Error("Deletion task is unavailable or already processing.");
    }

    if (candidate.resourceType === "Release") {
      const release = await tx.release.findUnique({ where: { id: candidate.resourceId }, include: { buildAsset: true } });
      if (!release?.deletedAt) throw new Error("Only trashed releases can be purged.");
      if (release.buildAsset && release.buildAsset.storageKey !== candidate.storageKey) throw new Error("Release storage key mismatch.");
    } else if (uploadTaskTypes.includes(candidate.resourceType)) {
      await assertUploadDeletionAllowed(tx, candidate, new Date());
    } else {
      throw new Error("Unknown storage deletion resource type.");
    }

    const claimedAt = new Date();
    const claimed = await tx.storageDeletionTask.updateMany({
      where: { id: candidate.id, status: candidate.status, completedAt: null, attempts: candidate.attempts, updatedAt: candidate.updatedAt },
      data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null, updatedAt: claimedAt },
    });
    if (!claimed.count) throw new Error("Deletion task is already processing.");
    return {
      task: candidate,
      lease: { id: candidate.id, status: "PROCESSING" as const, completedAt: null, attempts: candidate.attempts + 1, updatedAt: claimedAt },
    };
  });

  try {
    if (uploadTaskTypes.includes(task.resourceType)) await assertUploadDeletionAllowed(prisma, task, new Date());
    await deleteObject(task.storageKey);
    await prisma.$transaction(async (tx) => {
      const completedTask = await tx.storageDeletionTask.updateMany({
        where: lease,
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (!completedTask.count) throw new Error("Deletion task state changed unexpectedly.");

      if (task.resourceType === "Release") {
        const release = await tx.release.findUnique({ where: { id: task.resourceId }, include: { buildAsset: true, project: true } });
        if (!release?.deletedAt) throw new Error("Only trashed releases can be purged.");
        if (release.buildAsset) await tx.builderProfile.update({ where: { userId: release.project.ownerId }, data: { usedStorageBytes: { decrement: release.buildAsset.fileSizeBytes } } });
        await tx.release.delete({ where: { id: release.id } });
      } else if (uploadTaskTypes.includes(task.resourceType)) {
        await settleUploadReservation(tx, task.resourceId);
      }
      await tx.auditLog.create({ data: { actorUserId: admin.user.id, action: "storage.purged_immediately", targetType: task.resourceType, targetId: task.resourceId, metadataJson: { storageKey: task.storageKey } } });
    });
  } catch (error) {
    await prisma.storageDeletionTask.updateMany({
      where: lease,
      data: {
        status: "FAILED",
        lastError: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown storage deletion error",
      },
    });
    throw error;
  }
  revalidatePath("/admin");
}

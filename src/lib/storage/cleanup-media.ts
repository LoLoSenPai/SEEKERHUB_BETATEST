import type { Prisma, StorageDeletionTask } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { MEDIA_CLEANUP_GRACE_MS, queueMediaDeletion } from "@/src/features/project-media/service";
import { headObject } from "./s3";

type MediaTask = Pick<StorageDeletionTask, "resourceId" | "resourceType" | "storageKey">;

export async function queueExpiredProjectMedia(now: Date, deadline: number) {
  let queued = 0;
  const rows = await prisma.projectMedia.findMany({
    where: {
      OR: [
        { status: "PENDING", expiresAt: { lte: new Date(now.getTime() - MEDIA_CLEANUP_GRACE_MS) } },
        { status: "READY", project: { deletedAt: { not: null }, purgeAfter: { lte: now } } },
      ],
    },
    orderBy: { id: "asc" }, take: 100,
  });
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    const changed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AppProject" WHERE id = ${row.projectId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ProjectMedia" WHERE id = ${row.id} FOR UPDATE`;
      const media = await tx.projectMedia.findUnique({ where: { id: row.id }, include: { project: true } });
      if (!media || media.status === "DELETING") return false;
      const expired = media.status === "PENDING" && media.expiresAt.getTime() + MEDIA_CLEANUP_GRACE_MS <= now.getTime();
      const trashed = media.status === "READY" && media.project.deletedAt && media.project.purgeAfter && media.project.purgeAfter <= now;
      if (!expired && !trashed) return false;
      await queueMediaDeletion(tx, media, now);
      return true;
    });
    if (changed) queued++;
  }
  return queued;
}

export async function assertMediaDeletionAllowed(
  db: Pick<Prisma.TransactionClient, "projectMedia">, task: MediaTask, now: Date,
) {
  if (task.resourceType !== "ProjectMedia") throw new Error("Unknown media task type.");
  const media = await db.projectMedia.findUnique({ where: { id: task.resourceId } });
  if (!media || media.storageKey !== task.storageKey) throw new Error("Media row missing or storage key mismatch; manual review required.");
  if (media.status === "DELETING") return;
  if (media.status !== "PENDING" || media.expiresAt.getTime() + MEDIA_CLEANUP_GRACE_MS > now.getTime()) throw new Error("Media is visible or its upload safety window has not expired.");
  // Fence writers before touching S3. A writer holding this row lock must finish first.
  const changed = await db.projectMedia.updateMany({
    where: { id: media.id, status: "PENDING", expiresAt: media.expiresAt },
    data: { status: "DELETING", deletedAt: now },
  });
  if (!changed.count) throw new Error("Media state changed before deletion; retry cleanup.");
}

export async function assertMediaObjectAbsent(storageKey: string) {
  try {
    await headObject(storageKey);
  } catch (error) {
    if (typeof error === "object" && error !== null && "$metadata" in error &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return;
    throw error;
  }
  throw new Error("Media object is still present; quota must remain charged.");
}

/** Called only after physical DELETE + confirmed HEAD 404, in the task-completion transaction. */
export async function settleMediaDeletion(tx: Prisma.TransactionClient, task: MediaTask) {
  await tx.$queryRaw`SELECT id FROM "ProjectMedia" WHERE id = ${task.resourceId} FOR UPDATE`;
  const media = await tx.projectMedia.findUnique({ where: { id: task.resourceId }, include: { project: { select: { ownerId: true } } } });
  if (!media) return; // Idempotent settlement; the task's completion lease is the outer fence.
  if (media.storageKey !== task.storageKey || media.status !== "DELETING") throw new Error("Media deletion state mismatch.");
  const field = media.readyAt ? "usedStorageBytes" : "reservedStorageBytes";
  const changed = await tx.builderProfile.updateMany({
    where: { userId: media.project.ownerId, [field]: { gte: media.fileSizeBytes } },
    data: { [field]: { decrement: media.fileSizeBytes } },
  });
  if (!changed.count) throw new Error("Media storage accounting mismatch; manual review required.");
  await tx.projectMedia.delete({ where: { id: media.id } });
}

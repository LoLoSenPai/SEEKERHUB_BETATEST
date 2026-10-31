import type {
  Prisma,
  ReleaseUploadSession,
  StorageDeletionTask,
} from "@prisma/client";
import { prisma } from "@/src/lib/db";
import {
  inspectedApkKey,
  uploadCleanupAt,
  UPLOAD_STAGING_CLEANUP_GRACE_MS as STAGING_CLEANUP_GRACE_MS,
} from "@/src/lib/quota";

export const BATCH_SIZE = 25;
export const MAX_BATCHES = 4;

export function expiredReservations(
  now: Date,
): Prisma.ReleaseUploadSessionWhereInput {
  const staleFinalization = new Date(now.getTime() - 10 * 60_000);
  return {
    expiresAt: { lte: new Date(now.getTime() - STAGING_CLEANUP_GRACE_MS) },
    completedAt: null,
    reservationReleasedAt: null,
    OR: [{ finalizingAt: null }, { finalizingAt: { lte: staleFinalization } }],
  };
}

export async function queueExpiredReservations(now: Date, deadline: number) {
  let queued = 0;
  for (
    let batch = 0;
    batch < MAX_BATCHES && Date.now() < deadline;
    batch += 1
  ) {
    // Exclude already queued sessions without an unbounded in-memory ID list.
    const expired = await prisma.$queryRaw<ReleaseUploadSession[]>`
      SELECT u.* FROM "ReleaseUploadSession" u
      WHERE u."expiresAt" <= ${new Date(now.getTime() - STAGING_CLEANUP_GRACE_MS)}
        AND u."completedAt" IS NULL AND u."reservationReleasedAt" IS NULL
        AND (u."finalizingAt" IS NULL OR u."finalizingAt" <= ${new Date(now.getTime() - 10 * 60_000)})
        AND NOT EXISTS (
          SELECT 1 FROM "StorageDeletionTask" t
          WHERE t."storageKey" = u."storageKey"
        )
      ORDER BY u."expiresAt", u.id LIMIT ${BATCH_SIZE}
    `;
    for (const upload of expired) {
      if (Date.now() >= deadline) break;
      const didQueue = await prisma.$transaction(async (tx) => {
        const changed = await tx.releaseUploadSession.updateMany({
          where: {
            id: upload.id,
            ...expiredReservations(now),
          },
          data: { finalizingAt: null },
        });
        if (!changed.count) return false;
        const objects = [
          {
            storageKey: upload.storageKey,
            resourceType: "UploadStaging",
            resourceId: upload.id,
            scheduledFor: now,
          },
        ];
        if (upload.expectedSize && upload.reservedBytes > upload.expectedSize)
          objects.push({
            storageKey: inspectedApkKey(upload.projectId, upload.id),
            resourceType: "UploadFinal",
            resourceId: upload.id,
            scheduledFor: now,
          });
        await tx.storageDeletionTask.createMany({
          data: objects,
          skipDuplicates: true,
        });
        return true;
      });
      if (didQueue) queued += 1;
    }
    if (expired.length < BATCH_SIZE) break;
  }
  return queued;
}

export const uploadTaskTypes = [
  "UploadSession",
  "UploadStaging",
  "UploadFinal",
];

export function uploadDeletionSafeAfter(
  upload: Pick<ReleaseUploadSession, "expiresAt" | "finalizingAt">,
) {
  return new Date(
    Math.max(
      uploadCleanupAt(upload.expiresAt).getTime(),
      upload.finalizingAt ? upload.finalizingAt.getTime() + 10 * 60_000 : 0,
    ),
  );
}

export async function assertUploadDeletionAllowed(
  db: Pick<Prisma.TransactionClient, "releaseUploadSession" | "buildAsset">,
  task: Pick<StorageDeletionTask, "resourceId" | "resourceType" | "storageKey">,
  now: Date,
) {
  if (!uploadTaskTypes.includes(task.resourceType))
    throw new Error("Unknown upload deletion resource type.");
  const upload = await db.releaseUploadSession.findUnique({
    where: { id: task.resourceId },
  });
  if (!upload)
    throw new Error(
      "Upload session is missing; manual review required before storage deletion.",
    );
  if (uploadDeletionSafeAfter(upload) > now) {
    throw new Error(
      "Upload is active or its replay/finalization window has not expired.",
    );
  }
  const expectedKey =
    task.resourceType === "UploadFinal"
      ? inspectedApkKey(upload.projectId, upload.id)
      : upload.storageKey;
  if (
    task.storageKey !== expectedKey ||
    (task.resourceType !== "UploadStaging" && upload.completedAt)
  ) {
    throw new Error(
      "Refusing to purge a completed final object or mismatched upload key.",
    );
  }
  const asset = await db.buildAsset.findUnique({
    where: { storageKey: task.storageKey },
  });
  if (asset)
    throw new Error(
      "Refusing to purge upload storage referenced by a build asset.",
    );
}

export async function settleUploadReservation(
  tx: Prisma.TransactionClient,
  resourceId: string,
) {
  // Both cron and manual purge settle only after physical deletion, under this lock.
  await tx.$queryRaw`SELECT id FROM "ReleaseUploadSession" WHERE id = ${resourceId} FOR UPDATE`;
  const upload = await tx.releaseUploadSession.findUnique({
    where: { id: resourceId },
  });
  if (!upload) return;
  // Retain the whole remaining reservation until every physical object is gone.
  // This also handles legacy tasks whose reservation was already released.
  const outstanding = await tx.storageDeletionTask.count({
    where: {
      resourceId,
      resourceType: { in: uploadTaskTypes },
      status: { not: "COMPLETED" },
    },
  });
  if (outstanding) return;
  if (!upload.reservationReleasedAt) {
    const released = await tx.releaseUploadSession.updateMany({
      where: {
        id: upload.id,
        reservationReleasedAt: null,
        reservedBytes: upload.reservedBytes,
      },
      data: { reservedBytes: 0n, reservationReleasedAt: new Date() },
    });
    if (!released.count)
      throw new Error(
        "Upload reservation changed during cleanup; retry settlement.",
      );
    const profile = await tx.builderProfile.updateMany({
      where: {
        userId: upload.userId,
        reservedStorageBytes: { gte: upload.reservedBytes },
      },
      data: { reservedStorageBytes: { decrement: upload.reservedBytes } },
    });
    if (!profile.count)
      throw new Error(
        "Upload reservation accounting mismatch; manual review required.",
      );
  }
  // Completed sessions stay available for idempotent finalize responses.
  if (!upload.completedAt)
    await tx.releaseUploadSession.deleteMany({
      where: { id: upload.id, completedAt: null },
    });
}

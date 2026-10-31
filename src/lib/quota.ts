import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { AppError } from "@/src/lib/errors";
import { isTransactionConflict } from "@/src/lib/prisma-errors";

export const DEFAULT_MAX_APK_BYTES = 250 * 1024 * 1024;
export const UPLOAD_STAGING_CLEANUP_GRACE_MS = 60 * 60_000;

export function inspectedApkKey(projectId: string, sessionId: string) {
  return `projects/${projectId}/inspected-apks/${sessionId}/release.apk`;
}

export function uploadCleanupAt(expiresAt: Date) {
  return new Date(expiresAt.getTime() + UPLOAD_STAGING_CLEANUP_GRACE_MS);
}

async function scheduleUploadCleanup(tx: Prisma.TransactionClient, upload: {
  id: string; projectId: string; storageKey: string; expiresAt: Date; completedAt: Date | null;
}) {
  const objects = [{ storageKey: upload.storageKey, resourceType: "UploadStaging" }];
  if (!upload.completedAt) objects.push({ storageKey: inspectedApkKey(upload.projectId, upload.id), resourceType: "UploadFinal" });
  for (const { storageKey, resourceType } of objects) {
    await tx.storageDeletionTask.upsert({
      where: { storageKey },
      create: { storageKey, resourceType, resourceId: upload.id, scheduledFor: uploadCleanupAt(upload.expiresAt) },
      update: { status: "PENDING", scheduledFor: uploadCleanupAt(upload.expiresAt), completedAt: null, attempts: 0, lastError: null },
    });
  }
}

export async function reserveUploadQuota(input: {
  userId: string;
  projectId: string;
  bytes: number;
  storageKey: string;
  fileName: string;
  contentType: string;
  draft: Prisma.InputJsonValue;
  expiresAt: Date;
}) {
  if (!Number.isSafeInteger(input.bytes) || input.bytes <= 0) {
    throw new AppError("The APK size is required before upload.", 400, "INVALID_FILE_SIZE");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const profile = await tx.builderProfile.findUnique({ where: { userId: input.userId } });
          if (!profile || profile.status !== "ACTIVE") {
            throw new AppError("An active builder account is required.", 403, "BUILDER_REQUIRED");
          }

          const bytes = BigInt(input.bytes);
          const reservedBytes = bytes * 2n;
          if (bytes > profile.maxApkBytes) {
            throw new AppError("This APK exceeds your per-build upload limit.", 413, "APK_QUOTA_EXCEEDED");
          }

          if (profile.usedStorageBytes + profile.reservedStorageBytes + reservedBytes > profile.maxStorageBytes) {
            throw new AppError(
              "This upload needs temporary capacity for two APK copies (upload and inspected build). Free storage or choose a smaller APK before uploading.",
              413, "STORAGE_QUOTA_EXCEEDED",
            );
          }

          const releaseCount = await tx.release.count({
            where: { project: { ownerId: input.userId } },
          });
          const activeUploadCount = await tx.releaseUploadSession.count({
            where: {
              userId: input.userId,
              completedAt: null,
              reservationReleasedAt: null,
              expiresAt: { gt: new Date() },
            },
          });
          if (releaseCount + activeUploadCount >= profile.maxStoredReleases) {
            throw new AppError("Archive and purge a release before uploading another build.", 409, "RELEASE_QUOTA_EXCEEDED");
          }

          await tx.builderProfile.update({
            where: { userId: input.userId },
            data: { reservedStorageBytes: { increment: reservedBytes } },
          });

          const upload = await tx.releaseUploadSession.create({
            data: {
              projectId: input.projectId,
              userId: input.userId,
              storageKey: input.storageKey,
              originalFileName: input.fileName,
              contentType: input.contentType,
              expectedSize: bytes,
              reservedBytes,
              draftJson: input.draft,
              expiresAt: input.expiresAt,
            },
          });
          await scheduleUploadCleanup(tx, upload);
          return upload;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isTransactionConflict(error) && attempt === 0) continue;
      throw error;
    }
  }

  throw new AppError("Unable to reserve upload capacity.", 409, "QUOTA_RESERVATION_FAILED");
}

export async function releaseUploadReservation(sessionId: string) {
  // A presigned PUT is not revoked by cancellation or deletion. Keep capacity charged until
  // the cleanup worker has actually deleted every remaining object after the replay window.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const upload = await tx.releaseUploadSession.findUnique({ where: { id: sessionId } });
        if (!upload || upload.reservationReleasedAt) return;
        await scheduleUploadCleanup(tx, upload);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (isTransactionConflict(error) && attempt === 0) continue;
      throw error;
    }
  }
}

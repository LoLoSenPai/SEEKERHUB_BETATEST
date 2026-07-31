import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { AppError } from "@/src/lib/errors";
import { isTransactionConflict } from "@/src/lib/prisma-errors";

export const DEFAULT_MAX_APK_BYTES = 250 * 1024 * 1024;

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
          if (bytes > profile.maxApkBytes) {
            throw new AppError("This APK exceeds your per-build upload limit.", 413, "APK_QUOTA_EXCEEDED");
          }

          if (profile.usedStorageBytes + profile.reservedStorageBytes + bytes > profile.maxStorageBytes) {
            throw new AppError("This upload would exceed your storage quota.", 413, "STORAGE_QUOTA_EXCEEDED");
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
            data: { reservedStorageBytes: { increment: bytes } },
          });

          return tx.releaseUploadSession.create({
            data: {
              projectId: input.projectId,
              userId: input.userId,
              storageKey: input.storageKey,
              originalFileName: input.fileName,
              contentType: input.contentType,
              expectedSize: bytes,
              reservedBytes: bytes,
              draftJson: input.draft,
              expiresAt: input.expiresAt,
            },
          });
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
  await prisma.$transaction(async (tx) => {
    const upload = await tx.releaseUploadSession.findUnique({ where: { id: sessionId } });
    if (!upload || upload.reservationReleasedAt || upload.completedAt) return;

    await tx.releaseUploadSession.update({
      where: { id: sessionId },
      data: { reservationReleasedAt: new Date(), finalizingAt: null },
    });
    await tx.builderProfile.update({
      where: { userId: upload.userId },
      data: { reservedStorageBytes: { decrement: upload.reservedBytes } },
    });
    await tx.storageDeletionTask.upsert({
      where: { storageKey: upload.storageKey },
      create: {
        storageKey: upload.storageKey,
        resourceType: "UploadSession",
        resourceId: upload.id,
        scheduledFor: new Date(),
      },
      update: { status: "PENDING", scheduledFor: new Date(), lastError: null },
    });
  });
}

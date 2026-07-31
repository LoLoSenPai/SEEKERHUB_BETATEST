import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { getServerEnv } from "@/src/lib/env";
import { apiError, AppError } from "@/src/lib/errors";
import { deleteObject } from "@/src/lib/storage/s3";

async function releaseExpiredReservations(now: Date) {
  const staleFinalization = new Date(now.getTime() - 10 * 60_000);
  const expired = await prisma.releaseUploadSession.findMany({
    where: {
      expiresAt: { lte: now },
      completedAt: null,
      reservationReleasedAt: null,
      OR: [{ finalizingAt: null }, { finalizingAt: { lte: staleFinalization } }],
    },
  });
  for (const upload of expired) {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.releaseUploadSession.updateMany({
        where: {
          id: upload.id,
          completedAt: null,
          reservationReleasedAt: null,
          expiresAt: { lte: now },
          OR: [{ finalizingAt: null }, { finalizingAt: { lte: staleFinalization } }],
        },
        data: { reservationReleasedAt: now, finalizingAt: null },
      });
      if (!changed.count) return;
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
          scheduledFor: now,
        },
        update: { status: "PENDING", scheduledFor: now, lastError: null },
      });
    });
  }
  return expired.length;
}

async function processDeletionTasks(now: Date) {
  const staleProcessing = new Date(now.getTime() - 15 * 60_000);
  const tasks = await prisma.storageDeletionTask.findMany({
    where: {
      attempts: { lt: 5 },
      OR: [
        { status: { in: ["PENDING", "FAILED"] }, scheduledFor: { lte: now } },
        { status: "PROCESSING", updatedAt: { lte: staleProcessing } },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    take: 25,
  });
  let completed = 0;

  for (const task of tasks) {
    const claimed = await prisma.storageDeletionTask.updateMany({
      where: {
        id: task.id,
        attempts: { lt: 5 },
        OR: [
          { status: { in: ["PENDING", "FAILED"] }, scheduledFor: { lte: now } },
          { status: "PROCESSING", updatedAt: { lte: staleProcessing } },
        ],
      },
      data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null },
    });
    if (!claimed.count) continue;

    try {
      await deleteObject(task.storageKey);
      await prisma.$transaction(async (tx) => {
        const completedTask = await tx.storageDeletionTask.updateMany({
          where: { id: task.id, status: "PROCESSING", completedAt: null },
          data: { status: "COMPLETED", completedAt: now },
        });
        if (!completedTask.count) return;

        if (task.resourceType === "Release") {
          const release = await tx.release.findUnique({
            where: { id: task.resourceId },
            include: { buildAsset: true, project: { select: { ownerId: true } } },
          });
          if (release && !release.deletedAt) {
            throw new Error("Refusing to purge a release that is no longer in trash.");
          }
          if (release?.buildAsset) {
            await tx.builderProfile.update({
              where: { userId: release.project.ownerId },
              data: { usedStorageBytes: { decrement: release.buildAsset.fileSizeBytes } },
            });
          }
          if (release?.deletedAt) await tx.release.delete({ where: { id: release.id } });
        } else if (task.resourceType === "UploadSession") {
          await tx.releaseUploadSession.deleteMany({ where: { id: task.resourceId, completedAt: null } });
        }
      });
      completed += 1;
    } catch (error) {
      await prisma.storageDeletionTask.update({
        where: { id: task.id },
        data: {
          status: "FAILED",
          lastError: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown storage deletion error",
        },
      });
    }
  }
  return completed;
}

export async function GET(request: Request) {
  try {
    const secret = getServerEnv().CRON_SECRET;
    if (!secret) throw new AppError("Cleanup cron is not configured.", 503, "CRON_NOT_CONFIGURED");
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      throw new AppError("Unauthorized.", 401, "UNAUTHORIZED");
    }

    const now = new Date();
    const reservationsReleased = await releaseExpiredReservations(now);
    const objectsDeleted = await processDeletionTasks(now);
    const orphanReleasesPurged = await prisma.release.deleteMany({
      where: { deletedAt: { not: null }, purgeAfter: { lte: now }, buildAsset: null },
    });
    const completedTaskCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    const authRateLimitCutoff = BigInt(now.getTime() - 24 * 60 * 60_000);
    const [projectsPurged] = await Promise.all([
      prisma.appProject.deleteMany({
        where: { deletedAt: { not: null }, purgeAfter: { lte: now }, releases: { none: {} } },
      }),
      prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.rateLimit.deleteMany({ where: { lastRequest: { lt: authRateLimitCutoff } } }),
      prisma.walletChallenge.deleteMany({ where: { expiresAt: { lt: now }, usedAt: { not: null } } }),
      prisma.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.storageDeletionTask.deleteMany({
        where: { status: "COMPLETED", completedAt: { lt: completedTaskCutoff } },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      reservationsReleased,
      objectsDeleted,
      orphanReleasesPurged: orphanReleasesPurged.count,
      projectsPurged: projectsPurged.count,
    });
  } catch (error) {
    return apiError(error, "Cleanup failed.");
  }
}

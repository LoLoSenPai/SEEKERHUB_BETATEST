import type { Prisma } from "@prisma/client";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/src/lib/db";
import { getBucketName, storageClient } from "@/src/lib/storage/s3";
import { logger } from "@/src/lib/logger";
import {
  BATCH_SIZE,
  MAX_BATCHES,
  expiredReservations,
  queueExpiredReservations,
  settleUploadReservation,
  uploadTaskTypes,
  uploadDeletionSafeAfter,
  assertUploadDeletionAllowed,
} from "@/src/lib/storage/cleanup-uploads";
import { pruneRetention } from "@/src/lib/storage/cleanup-retention";

const MAX_ATTEMPTS = 5;
const PROCESSING_LEASE_MS = 15 * 60_000;
const WORK_BUDGET_MS = 40_000;

function eligibleDeletionTasks(
  now: Date,
): Prisma.StorageDeletionTaskWhereInput {
  return {
    completedAt: null,
    OR: [
      {
        status: { in: ["PENDING", "FAILED"] },
        attempts: { lt: MAX_ATTEMPTS },
        scheduledFor: { lte: now },
      },
      {
        status: "PROCESSING",
        updatedAt: { lte: new Date(now.getTime() - PROCESSING_LEASE_MS) },
      },
    ],
  };
}

async function processDeletionTasks(deadline: number) {
  let completed = 0;
  let failed = 0;
  let claimedCount = 0;
  for (
    let batch = 0;
    batch < MAX_BATCHES && Date.now() < deadline;
    batch += 1
  ) {
    const tasks = await prisma.storageDeletionTask.findMany({
      where: eligibleDeletionTasks(new Date()),
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
    });
    for (const task of tasks) {
      if (Date.now() >= deadline) break;
      const claimedAt = new Date();
      // updatedAt and attempts fence a reclaimed lease from an older worker.
      const candidate = {
        id: task.id,
        updatedAt: task.updatedAt,
        attempts: task.attempts,
        ...eligibleDeletionTasks(claimedAt),
      };
      if (task.attempts >= MAX_ATTEMPTS) {
        const exhausted = await prisma.storageDeletionTask.updateMany({
          where: candidate,
          data: {
            status: "FAILED",
            lastError:
              "Processing lease expired after the final attempt; manual review required.",
          },
        });
        failed += exhausted.count;
        continue;
      }
      if (uploadTaskTypes.includes(task.resourceType)) {
        const upload = await prisma.releaseUploadSession.findUnique({
          where: { id: task.resourceId },
        });
        if (upload) {
          const safeAfter = uploadDeletionSafeAfter(upload);
          if (safeAfter > claimedAt) {
            await prisma.storageDeletionTask.updateMany({
              where: candidate,
              data: { status: "PENDING", scheduledFor: safeAfter },
            });
            continue;
          }
        }
      }
      const claimed = await prisma.storageDeletionTask.updateMany({
        where: candidate,
        data: {
          status: "PROCESSING",
          attempts: { increment: 1 },
          lastError: null,
          updatedAt: claimedAt,
        },
      });
      if (!claimed.count) continue;
      claimedCount += 1;
      const lease = {
        id: task.id,
        status: "PROCESSING" as const,
        completedAt: null,
        updatedAt: claimedAt,
        attempts: task.attempts + 1,
      };

      try {
        // Validate before deleting storage, not only after the irreversible operation.
        if (task.resourceType === "Release") {
          const release = await prisma.release.findUnique({
            where: { id: task.resourceId },
            include: { buildAsset: true },
          });
          if (
            release &&
            (!release.deletedAt ||
              !release.purgeAfter ||
              release.purgeAfter > claimedAt ||
              (release.buildAsset &&
                release.buildAsset.storageKey !== task.storageKey))
          ) {
            throw new Error(
              "Refusing to purge a release outside its expired trash window.",
            );
          }
        } else if (uploadTaskTypes.includes(task.resourceType)) {
          await assertUploadDeletionAllowed(prisma, task, new Date());
        } else {
          throw new Error("Unknown storage deletion resource type.");
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0)
          throw new Error(
            "Cleanup work budget exhausted before storage deletion.",
          );
        await storageClient.send(
          new DeleteObjectCommand({
            Bucket: getBucketName(),
            Key: task.storageKey,
          }),
          {
            abortSignal: AbortSignal.timeout(Math.min(10_000, remainingMs)),
          },
        );
        const didComplete = await prisma.$transaction(async (tx) => {
          const completedTask = await tx.storageDeletionTask.updateMany({
            where: lease,
            data: { status: "COMPLETED", completedAt: new Date() },
          });
          if (!completedTask.count) return false;

          if (task.resourceType === "Release") {
            const release = await tx.release.findUnique({
              where: { id: task.resourceId },
              include: {
                buildAsset: true,
                project: { select: { ownerId: true } },
              },
            });
            if (release && !release.deletedAt) {
              throw new Error(
                "Refusing to purge a release that is no longer in trash.",
              );
            }
            if (release?.buildAsset) {
              await tx.builderProfile.update({
                where: { userId: release.project.ownerId },
                data: {
                  usedStorageBytes: {
                    decrement: release.buildAsset.fileSizeBytes,
                  },
                },
              });
            }
            if (release?.deletedAt)
              await tx.release.delete({ where: { id: release.id } });
          } else if (uploadTaskTypes.includes(task.resourceType)) {
            await settleUploadReservation(tx, task.resourceId);
          }
          return true;
        });
        if (didComplete) completed += 1;
      } catch (error) {
        const retryAt = new Date(
          Date.now() +
            Math.min(6 * 60 * 60_000, 5 * 60_000 * 2 ** task.attempts),
        );
        const changed = await prisma.storageDeletionTask.updateMany({
          where: lease,
          data: {
            status: "FAILED",
            scheduledFor: retryAt,
            lastError:
              error instanceof Error
                ? error.message.slice(0, 1_000)
                : "Unknown storage deletion error",
          },
        });
        failed += changed.count;
        logger.warn("cleanup.deletion_failed", {
          taskId: task.id,
          attempt: task.attempts + 1,
          retryAt,
          exhausted: task.attempts + 1 >= MAX_ATTEMPTS,
        });
      }
    }
    if (tasks.length < BATCH_SIZE) break;
  }
  return { completed, failed, claimed: claimedCount };
}

async function logBacklog(now: Date) {
  const [reservations, due, deferred, processing, exhausted, oldest] =
    await Promise.all([
      prisma.releaseUploadSession.count({ where: expiredReservations(now) }),
      prisma.storageDeletionTask.count({ where: eligibleDeletionTasks(now) }),
      prisma.storageDeletionTask.count({
        where: {
          status: { in: ["PENDING", "FAILED"] },
          attempts: { lt: MAX_ATTEMPTS },
          scheduledFor: { gt: now },
        },
      }),
      prisma.storageDeletionTask.count({ where: { status: "PROCESSING" } }),
      prisma.storageDeletionTask.count({
        where: { status: "FAILED", attempts: { gte: MAX_ATTEMPTS } },
      }),
      prisma.storageDeletionTask.findFirst({
        where: eligibleDeletionTasks(now),
        orderBy: { scheduledFor: "asc" },
        select: { scheduledFor: true },
      }),
    ]);
  const backlog = {
    reservations,
    due,
    deferred,
    processing,
    exhausted,
    oldestDueAgeSeconds: oldest
      ? Math.max(
          0,
          Math.floor((now.getTime() - oldest.scheduledFor.getTime()) / 1_000),
        )
      : 0,
  };
  if (exhausted) logger.error("cleanup.manual_review_required", backlog);
  return backlog;
}

export async function runStorageCleanup() {
  const startedAt = Date.now();
  try {
    const now = new Date();
    const deadline = startedAt + WORK_BUDGET_MS;
    const reservationsQueued = await queueExpiredReservations(
      now,
      Math.min(deadline, startedAt + WORK_BUDGET_MS / 2),
    );
    const deletion = await processDeletionTasks(deadline);
    const { orphanReleasesPurged, projectsPurged } = await pruneRetention(now);
    const backlog = await logBacklog(new Date());
    logger.info("cleanup.completed", {
      durationMs: Date.now() - startedAt,
      reservationsQueued,
      deletion,
      backlog,
      budgetReached: Date.now() >= deadline,
    });
    return {
      ok: true,
      reservationsQueued,
      objectsDeleted: deletion.completed,
      deletion,
      backlog,
      orphanReleasesPurged,
      projectsPurged,
    };
  } catch (error) {
    logger.error("cleanup.failed", {
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

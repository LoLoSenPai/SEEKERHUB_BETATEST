import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { BATCH_SIZE } from "@/src/lib/storage/cleanup-uploads";

async function pruneBatch<T extends { id: string }>(
  select: () => Promise<T[]>,
  remove: (ids: string[]) => Promise<{ count: number }>,
) {
  const rows = await select();
  return rows.length ? (await remove(rows.map((row) => row.id))).count : 0;
}

export async function pruneRetention(now: Date) {
  const orphanWhere = {
    deletedAt: { not: null },
    purgeAfter: { lte: now },
    buildAsset: null,
  };
  const orphanReleasesPurged = await pruneBatch(
    () =>
      prisma.release.findMany({
        where: orphanWhere,
        select: { id: true },
        take: BATCH_SIZE,
      }),
    (ids) =>
      prisma.release.deleteMany({
        where: { ...orphanWhere, id: { in: ids } },
      }),
  );
  const completedTaskCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const authRateLimitCutoff = BigInt(now.getTime() - 24 * 60 * 60_000);
  const projectWhere: Prisma.AppProjectWhereInput = {
    deletedAt: { not: null },
    purgeAfter: { lte: now },
    releases: { none: {} },
    uploadSessions: { none: { reservationReleasedAt: null } },
    media: { none: {} },
  };
  const [projectsPurged] = await Promise.all([
    pruneBatch(
      () =>
        prisma.appProject.findMany({
          where: projectWhere,
          select: { id: true },
          take: BATCH_SIZE,
        }),
      (ids) =>
        prisma.appProject.deleteMany({
          where: { ...projectWhere, id: { in: ids } },
        }),
    ),
    pruneBatch(
      () =>
        prisma.rateLimitBucket.findMany({
          where: { expiresAt: { lt: now } },
          select: { id: true },
          take: 500,
        }),
      (ids) =>
        prisma.rateLimitBucket.deleteMany({
          where: { id: { in: ids }, expiresAt: { lt: now } },
        }),
    ),
    pruneBatch(
      () =>
        prisma.rateLimit.findMany({
          where: { lastRequest: { lt: authRateLimitCutoff } },
          select: { id: true },
          take: 500,
        }),
      (ids) =>
        prisma.rateLimit.deleteMany({
          where: {
            id: { in: ids },
            lastRequest: { lt: authRateLimitCutoff },
          },
        }),
    ),
    pruneBatch(
      () =>
        prisma.walletChallenge.findMany({
          where: { expiresAt: { lt: now }, usedAt: { not: null } },
          select: { id: true },
          take: 500,
        }),
      (ids) =>
        prisma.walletChallenge.deleteMany({
          where: {
            id: { in: ids },
            expiresAt: { lt: now },
            usedAt: { not: null },
          },
        }),
    ),
    pruneBatch(
      () =>
        prisma.verification.findMany({
          where: { expiresAt: { lt: now } },
          select: { id: true },
          take: 500,
        }),
      (ids) =>
        prisma.verification.deleteMany({
          where: { id: { in: ids }, expiresAt: { lt: now } },
        }),
    ),
    pruneBatch(
      () =>
        prisma.storageDeletionTask.findMany({
          where: {
            status: "COMPLETED",
            completedAt: { lt: completedTaskCutoff },
          },
          select: { id: true },
          take: 500,
        }),
      (ids) =>
        prisma.storageDeletionTask.deleteMany({
          where: {
            id: { in: ids },
            status: "COMPLETED",
            completedAt: { lt: completedTaskCutoff },
          },
        }),
    ),
  ]);

  return { orphanReleasesPurged, projectsPurged };
}

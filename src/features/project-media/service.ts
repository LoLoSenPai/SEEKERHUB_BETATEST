import { randomUUID } from "node:crypto";
import { Prisma, type ProjectMedia } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { AppError } from "@/src/lib/errors";
import { isTransactionConflict } from "@/src/lib/prisma-errors";
import { uploadNormalizedMedia } from "@/src/lib/storage/project-media";
import { MAX_PROJECT_MEDIA_BYTES } from "./validation";
import type { ProjectMediaKind } from "./types";

// Server PUT is bounded to 20 seconds; stale writers get a further one-hour grace.
export const MEDIA_PENDING_TTL_MS = 5 * 60_000;
export const MEDIA_CLEANUP_GRACE_MS = 60 * 60_000;

export async function lockOwnedMediaProject(tx: Prisma.TransactionClient, projectId: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM "AppProject" WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.appProject.findFirst({ where: { id: projectId, ownerId: userId, deletedAt: null }, select: { id: true } });
  if (!project) throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");
}

async function serializable<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt < 2 && isTransactionConflict(error)) continue;
      throw error;
    }
  }
}

export async function queueMediaDeletion(tx: Prisma.TransactionClient, media: ProjectMedia, scheduledFor = new Date()) {
  await tx.projectMedia.update({ where: { id: media.id }, data: { status: "DELETING", deletedAt: new Date() } });
  await tx.storageDeletionTask.upsert({
    where: { storageKey: media.storageKey },
    create: { storageKey: media.storageKey, resourceType: "ProjectMedia", resourceId: media.id, scheduledFor },
    update: { scheduledFor },
  });
}

export async function reserveMediaQuota(input: {
  userId: string; projectId: string; kind: ProjectMediaKind; replaceId?: string;
  bytes: number; width: number; height: number;
}) {
  if (!Number.isSafeInteger(input.bytes) || input.bytes <= 0 || input.bytes > (input.kind === "ICON" ? 256 * 1024 : 1024 * 1024)) {
    throw new AppError("Invalid normalized media size.", 400, "INVALID_MEDIA_SIZE");
  }
  return serializable(async (tx) => {
    await lockOwnedMediaProject(tx, input.projectId, input.userId);
    const profile = await tx.builderProfile.findUnique({ where: { userId: input.userId } });
    if (!profile || profile.status !== "ACTIVE") throw new AppError("An active builder account is required.", 403, "BUILDER_REQUIRED");
    const rows = await tx.projectMedia.findMany({ where: { projectId: input.projectId } });
    const bytes = BigInt(input.bytes);
    // Includes replaced objects and abandoned reservations until physical deletion.
    const projectBytes = rows.reduce((sum, row) => sum + row.fileSizeBytes, 0n);
    if (projectBytes + bytes > BigInt(MAX_PROJECT_MEDIA_BYTES)) throw new AppError("Project media needs free capacity within its 8 MiB limit. Wait for cleanup or remove an image.", 413, "PROJECT_MEDIA_QUOTA_EXCEEDED");
    if (profile.usedStorageBytes + profile.reservedStorageBytes + bytes > profile.maxStorageBytes) throw new AppError("Not enough storage capacity for this image and any replaced image awaiting cleanup.", 413, "STORAGE_QUOTA_EXCEEDED");
    const active = rows.filter((row) => row.kind === input.kind && row.status !== "DELETING");
    const original = input.replaceId
      ? active.find((row) => row.id === input.replaceId && row.status === "READY")
      : input.kind === "SCREENSHOT" ? undefined : active.find((row) => row.status === "READY");
    if (input.replaceId && !original) throw new AppError("Image not found.", 404, "MEDIA_NOT_FOUND");
    let position = original?.position ?? 0;
    if (input.kind === "SCREENSHOT" && !original) {
      position = [0, 1, 2, 3, 4].find((slot) => !active.some((row) => row.position === slot)) ?? -1;
      if (position < 0) throw new AppError("Up to five screenshots are allowed.", 409, "MEDIA_SLOT_LIMIT");
    }
    if (active.some((row) => row.position === position && row.status === "PENDING")) throw new AppError("An upload is already in progress for this image.", 409, "MEDIA_UPLOAD_PENDING");
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + MEDIA_PENDING_TTL_MS);
    const media = await tx.projectMedia.create({ data: {
      id, projectId: input.projectId, kind: input.kind, position, replacesId: original?.id,
      storageKey: `projects/${input.projectId}/media/${id}.webp`, fileSizeBytes: bytes,
      width: input.width, height: input.height, expiresAt,
    } });
    await tx.builderProfile.update({ where: { userId: input.userId }, data: { reservedStorageBytes: { increment: bytes } } });
    await tx.storageDeletionTask.create({ data: {
      resourceType: "ProjectMedia", resourceId: id, storageKey: media.storageKey,
      scheduledFor: new Date(expiresAt.getTime() + MEDIA_CLEANUP_GRACE_MS),
    } });
    return media;
  });
}

export async function storeProjectMedia(input: {
  userId: string; projectId: string; kind: ProjectMediaKind; replaceId?: string;
  data: Buffer; width: number; height: number;
}) {
  const reserved = await reserveMediaQuota({ ...input, bytes: input.data.length });
  // Never auto-retry this transaction: it contains a physical PUT. Its durable pending
  // row + pre-created deletion task survive PUT ambiguity, DB failure and process death.
  await prisma.$transaction(async (tx) => {
    await lockOwnedMediaProject(tx, input.projectId, input.userId);
    await tx.$queryRaw`SELECT id FROM "ProjectMedia" WHERE id = ${reserved.id} FOR UPDATE`;
    const media = await tx.projectMedia.findUniqueOrThrow({ where: { id: reserved.id } });
    if (media.status !== "PENDING" || media.expiresAt <= new Date()) throw new AppError("Upload expired. Try again after cleanup.", 409, "MEDIA_UPLOAD_EXPIRED");
    const profile = await tx.builderProfile.findUnique({ where: { userId: input.userId } });
    if (!profile || profile.status !== "ACTIVE") throw new AppError("An active builder account is required.", 403, "BUILDER_REQUIRED");
    await uploadNormalizedMedia(media.storageKey, input.data);
    if (media.replacesId) {
      const original = await tx.projectMedia.findUnique({ where: { id: media.replacesId } });
      if (!original || original.projectId !== media.projectId || original.status !== "READY") throw new AppError("The original image changed. Please retry.", 409, "MEDIA_REPLACEMENT_CHANGED");
      await queueMediaDeletion(tx, original);
    }
    const moved = await tx.builderProfile.updateMany({
      where: { userId: input.userId, reservedStorageBytes: { gte: media.fileSizeBytes } },
      data: { reservedStorageBytes: { decrement: media.fileSizeBytes }, usedStorageBytes: { increment: media.fileSizeBytes } },
    });
    if (!moved.count) throw new Error("Media reservation accounting mismatch.");
    await tx.projectMedia.update({ where: { id: media.id }, data: { status: "READY", readyAt: new Date() } });
    await tx.storageDeletionTask.delete({ where: { storageKey: media.storageKey } });
  }, { timeout: 45_000, maxWait: 5_000 });
}

export async function deleteProjectMedia(userId: string, projectId: string, id: string) {
  return serializable(async (tx) => {
    await lockOwnedMediaProject(tx, projectId, userId);
    const media = await tx.projectMedia.findFirst({ where: { id, projectId, status: "READY" } });
    if (!media) throw new AppError("Image not found.", 404, "MEDIA_NOT_FOUND");
    const pending = await tx.projectMedia.count({ where: { projectId, status: "PENDING", replacesId: id } });
    if (pending) throw new AppError("An image replacement is in progress.", 409, "MEDIA_UPLOAD_PENDING");
    await queueMediaDeletion(tx, media);
  });
}

export async function reorderProjectMedia(userId: string, projectId: string, ids: string[]) {
  return serializable(async (tx) => {
    await lockOwnedMediaProject(tx, projectId, userId);
    if (await tx.projectMedia.count({ where: { projectId, status: "PENDING", kind: "SCREENSHOT" } })) throw new AppError("Wait for screenshot uploads to finish.", 409, "MEDIA_UPLOAD_PENDING");
    const rows = await tx.projectMedia.findMany({ where: { projectId, kind: "SCREENSHOT", status: "READY" } });
    if (rows.length !== ids.length || new Set(ids).size !== ids.length || !rows.every((row) => ids.includes(row.id))) throw new AppError("Screenshot order is invalid.", 400, "INVALID_MEDIA_ORDER");
    // Temporarily hide within this transaction to avoid partial unique-index collisions.
    await tx.projectMedia.updateMany({ where: { id: { in: ids }, projectId }, data: { status: "DELETING" } });
    for (const [position, id] of ids.entries()) await tx.projectMedia.update({ where: { id }, data: { position, status: "READY" } });
  });
}

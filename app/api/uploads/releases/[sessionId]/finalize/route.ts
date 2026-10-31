import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { inspectApkFile } from "@/src/lib/apk";
import { prisma } from "@/src/lib/db";
import { apiError, AppError } from "@/src/lib/errors";
import { requireBuilderApiSession } from "@/src/lib/session";
import { downloadObjectToFile, getBucketName, headObject, uploadInspectedApk } from "@/src/lib/storage/s3";
import { releaseDraftInputSchema } from "@/src/lib/validation";
import { logger } from "@/src/lib/logger";
import { isTransactionConflict } from "@/src/lib/prisma-errors";
import { inspectedApkKey, uploadCleanupAt } from "@/src/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 300;
const FINALIZE_LEASE_MS = 10 * 60_000;

type Metadata = Awaited<ReturnType<typeof inspectApkFile>>;

async function finalizeTransaction<T>(action: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt < 2 && isTransactionConflict(error)) continue;
      throw error;
    }
  }
}

function result(releaseId: string, metadata: Omit<Metadata, "detectedMimeType" | "hasApkSignature"> & { hasApkSignature: boolean }) {
  return NextResponse.json({
    releaseId,
    metadata: {
      packageName: metadata.packageName,
      versionName: metadata.versionName,
      versionCode: metadata.versionCode,
      minSdk: metadata.minSdk,
      targetSdk: metadata.targetSdk,
      fileSizeBytes: metadata.fileSizeBytes.toString(),
      sha256Checksum: metadata.sha256Checksum,
      signatureMarkerDetected: metadata.hasApkSignature,
    },
  });
}

async function completedResult(storageKey: string, userId: string) {
  const asset = await prisma.buildAsset.findUnique({
    where: { storageKey },
    include: { release: { include: { project: true } } },
  });
  if (!asset || asset.release.createdById !== userId || asset.release.deletedAt || asset.release.project.deletedAt) {
    throw new AppError("The finalized release is no longer available.", 410, "RELEASE_UNAVAILABLE");
  }
  return result(asset.releaseId, {
    packageName: asset.release.project.androidPackageName!,
    versionName: asset.release.versionName,
    versionCode: asset.release.versionCode,
    minSdk: asset.release.minSdk,
    targetSdk: asset.release.targetSdk,
    fileSizeBytes: asset.fileSizeBytes,
    sha256Checksum: asset.sha256Checksum,
    hasApkSignature: asset.hasApkSignature,
  });
}

async function finalObjectExists(key: string) {
  try {
    await headObject(key);
    return true;
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  let lease: Date | null = null;
  let directory: string | null = null;
  try {
    const session = await requireBuilderApiSession(request);
    const upload = await prisma.releaseUploadSession.findFirst({
      where: { id: sessionId, userId: session.user.id, project: { ownerId: session.user.id } },
      include: { project: true },
    });
    if (!upload || upload.project.deletedAt) throw new AppError("Upload session not found.", 404, "UPLOAD_NOT_FOUND");
    const finalKey = inspectedApkKey(upload.projectId, upload.id);
    if (upload.completedAt) return await completedResult(finalKey, session.user.id);
    if (upload.reservationReleasedAt || upload.expiresAt <= new Date()) {
      throw new AppError("Upload session expired.", 410, "UPLOAD_EXPIRED");
    }
    if (!upload.expectedSize || upload.expectedSize <= 0n || upload.expectedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new AppError("Upload size reservation is missing or invalid.", 400);
    }
    const expectedSize = upload.expectedSize;

    const claimedAt = new Date();
    const cleanupAt = uploadCleanupAt(upload.expiresAt);
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.releaseUploadSession.updateMany({
        where: {
          id: upload.id,
          userId: session.user.id,
          completedAt: null,
          reservationReleasedAt: null,
          OR: [{ finalizingAt: null }, { finalizingAt: { lte: new Date(claimedAt.getTime() - FINALIZE_LEASE_MS) } }],
          expiresAt: { gt: claimedAt },
        },
        data: { finalizingAt: claimedAt },
      });
      if (!claim.count) return false;
      const current = await tx.releaseUploadSession.findUniqueOrThrow({ where: { id: upload.id } });
      const extra = expectedSize * 2n - current.reservedBytes;
      if (extra > 0n) {
        const profile = await tx.builderProfile.findUnique({ where: { userId: session.user.id } });
        if (!profile || profile.status !== "ACTIVE") throw new AppError("An active builder account is required.", 403);
        if (profile.usedStorageBytes + profile.reservedStorageBytes + extra > profile.maxStorageBytes) {
          throw new AppError("Finalizing requires capacity for both staging and inspected APK bytes.", 413, "STORAGE_QUOTA_EXCEEDED");
        }
        const reserved = await tx.builderProfile.updateMany({
          where: {
            userId: session.user.id,
            usedStorageBytes: profile.usedStorageBytes,
            reservedStorageBytes: profile.reservedStorageBytes,
          },
          data: { reservedStorageBytes: { increment: extra } },
        });
        if (!reserved.count) throw new AppError("Storage quota changed; retry finalization.", 409, "QUOTA_CONFLICT");
        await tx.releaseUploadSession.update({
          where: { id: upload.id }, data: { reservedBytes: current.reservedBytes + extra },
        });
      }
      // Persist cleanup intent before object writes. A committed draft removes only the
      // orphan-final task; otherwise both staging and unreferenced final bytes are collectible.
      for (const [storageKey, resourceType] of [[upload.storageKey, "UploadStaging"], [finalKey, "UploadFinal"]]) {
        await tx.storageDeletionTask.upsert({
          where: { storageKey },
          create: { storageKey, resourceType, resourceId: upload.id, scheduledFor: cleanupAt },
          update: { status: "PENDING", scheduledFor: cleanupAt, completedAt: null, attempts: 0, lastError: null },
        });
      }
      return true;
    });
    if (!claimed) {
      const current = await prisma.releaseUploadSession.findUnique({ where: { id: upload.id } });
      if (current?.completedAt) return await completedResult(finalKey, session.user.id);
      throw new AppError("Upload finalization is already in progress or expired.", 409, "UPLOAD_FINALIZING");
    }
    lease = claimedAt;

    directory = await mkdtemp(join(tmpdir(), "seekerhub-apk-"));
    const filePath = join(directory, "release.apk");
    // Recover the immutable snapshot after a lost response, not a replaced staging object.
    const recoverFinal = await finalObjectExists(finalKey);
    await downloadObjectToFile(recoverFinal ? finalKey : upload.storageKey, filePath, expectedSize);
    const metadata = await inspectApkFile(filePath);
    if (metadata.fileSizeBytes !== expectedSize) {
      throw new AppError("The downloaded APK size does not match the reserved upload.", 400, "UPLOAD_SIZE_MISMATCH");
    }
    const draft = releaseDraftInputSchema.parse(upload.draftJson);
    if (!recoverFinal) {
      // Upload the same private local snapshot that was hashed and inspected, never an S3 copy.
      await uploadInspectedApk({ key: finalKey, filePath, ...metadata, contentType: metadata.detectedMimeType });
    }

    const release = await finalizeTransaction(async (tx) => {
      const project = await tx.appProject.findFirst({
        where: { id: upload.projectId, ownerId: session.user.id, deletedAt: null },
      });
      if (!project) throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");
      if (project.androidPackageName && project.androidPackageName !== metadata.packageName) {
        throw new AppError(
          `This project is bound to ${project.androidPackageName}; the uploaded APK contains ${metadata.packageName}.`,
          409, "ANDROID_PACKAGE_MISMATCH",
        );
      }
      const current = await tx.releaseUploadSession.updateMany({
        where: { id: upload.id, completedAt: null, reservationReleasedAt: null, finalizingAt: claimedAt },
        data: { completedAt: new Date(), finalizingAt: null, reservedBytes: expectedSize },
      });
      if (!current.count) throw new AppError("Upload finalization lease was lost.", 409, "UPLOAD_LEASE_LOST");
      if (draft.accessPolicy.testerGroupId) {
        const group = await tx.testerGroup.findFirst({
          where: { id: draft.accessPolicy.testerGroupId, projectId: project.id },
        });
        if (!group) throw new AppError("Tester group not found in this project.", 400, "INVALID_TESTER_GROUP");
      }
      const createdRelease = await tx.release.create({
        data: {
          projectId: project.id,
          createdById: session.user.id,
          versionName: metadata.versionName,
          versionCode: metadata.versionCode,
          minSdk: metadata.minSdk,
          targetSdk: metadata.targetSdk,
          changelog: draft.changelog,
          status: "DRAFT",
        },
      });
      await tx.appProject.update({ where: { id: project.id }, data: { androidPackageName: metadata.packageName } });
      await tx.buildAsset.create({
        data: {
          releaseId: createdRelease.id,
          storageKey: finalKey,
          bucket: getBucketName(),
          originalFileName: upload.originalFileName,
          contentType: metadata.detectedMimeType,
          fileSizeBytes: metadata.fileSizeBytes,
          sha256Checksum: metadata.sha256Checksum,
          hasApkSignature: metadata.hasApkSignature,
          validatedAt: new Date(),
        },
      });
      await tx.accessPolicy.create({
        data: {
          releaseId: createdRelease.id,
          requireInviteAcceptance: draft.accessPolicy.requireInviteAcceptance,
          testerGroupId: draft.accessPolicy.testerGroupId || null,
          requireLinkedWallet: draft.accessPolicy.requireLinkedWallet,
          requireSolanaMobile: draft.accessPolicy.requireSolanaMobile,
          requireVerifiedSeeker: draft.accessPolicy.requireVerifiedSeeker,
          allowPreviousReleases: draft.accessPolicy.allowPreviousReleases,
          walletEntries: { create: draft.accessPolicy.walletAllowlist.map((address) => ({ address })) },
        },
      });
      // Staging remains reserved until delayed deletion succeeds: its PUT can still be replayed.
      await tx.builderProfile.update({
        where: { userId: session.user.id },
        data: {
          usedStorageBytes: { increment: metadata.fileSizeBytes },
          reservedStorageBytes: { decrement: metadata.fileSizeBytes },
        },
      });
      await tx.storageDeletionTask.deleteMany({ where: { storageKey: finalKey } });
      await tx.auditLog.create({
        data: {
          actorUserId: session.user.id,
          action: "release.draft_created",
          targetType: "Release",
          targetId: createdRelease.id,
          metadataJson: { packageName: metadata.packageName, versionCode: metadata.versionCode },
        },
      });
      return createdRelease;
    });
    return result(release.id, metadata);
  } catch (error) {
    if (lease) {
      // Retain quota and durable cleanup intents; recoverable failures can be retried.
      await prisma.releaseUploadSession.updateMany({
        where: { id: sessionId, completedAt: null, finalizingAt: lease },
        data: { finalizingAt: null },
      }).catch((cleanupError) => logger.error("upload.lease_cleanup_failed", { sessionId, error: cleanupError }));
    }
    return apiError(error, "Unable to finalize release upload.");
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch((error) => {
      logger.error("upload.local_cleanup_failed", { sessionId, error });
    });
  }
}

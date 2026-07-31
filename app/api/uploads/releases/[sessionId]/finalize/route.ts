import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { inspectApkFile } from "@/src/lib/apk";
import { prisma } from "@/src/lib/db";
import { apiError, AppError } from "@/src/lib/errors";
import { releaseUploadReservation } from "@/src/lib/quota";
import { requireBuilderApiSession } from "@/src/lib/session";
import { deleteObject, downloadObjectToFile, getBucketName, headObject } from "@/src/lib/storage/s3";
import { releaseDraftInputSchema } from "@/src/lib/validation";
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";
import { logger } from "@/src/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

async function inspectStoredUpload(storageKey: string, expectedSize: bigint) {
  const head = await headObject(storageKey);
  const storageSize = head.ContentLength == null ? null : BigInt(head.ContentLength);
  if (storageSize !== expectedSize || head.Metadata?.["expected-size"] !== expectedSize.toString()) {
    throw new AppError("The stored object size does not match the reserved upload.", 400, "UPLOAD_SIZE_MISMATCH");
  }

  const directory = await mkdtemp(join(tmpdir(), "seekerhub-apk-"));
  const filePath = join(directory, "release.apk");
  try {
    await downloadObjectToFile(storageKey, filePath);
    const metadata = await inspectApkFile(filePath);
    if (metadata.fileSizeBytes !== expectedSize) {
      throw new AppError("The downloaded APK size does not match the reserved upload.", 400, "UPLOAD_SIZE_MISMATCH");
    }
    return metadata;
  } finally {
    await unlink(filePath).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  let storageKey: string | null = null;
  let claimedForFinalize = false;
  let finalized = false;

  try {
    const session = await requireBuilderApiSession(request);
    const upload = await prisma.releaseUploadSession.findFirst({
      where: { id: sessionId, userId: session.user.id },
      include: { project: true },
    });
    if (!upload || upload.project.deletedAt) throw new AppError("Upload session not found.", 404, "UPLOAD_NOT_FOUND");
    storageKey = upload.storageKey;
    if (upload.completedAt) throw new AppError("Upload session already finalized.", 409, "UPLOAD_ALREADY_FINALIZED");
    if (upload.reservationReleasedAt || upload.expiresAt <= new Date()) {
      throw new AppError("Upload session expired.", 410, "UPLOAD_EXPIRED");
    }
    if (!upload.expectedSize || upload.expectedSize <= 0n) throw new AppError("Upload size reservation is missing.", 400);

    const claim = await prisma.releaseUploadSession.updateMany({
      where: {
        id: upload.id,
        userId: session.user.id,
        completedAt: null,
        reservationReleasedAt: null,
        finalizingAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { finalizingAt: new Date() },
    });
    if (!claim.count) {
      const current = await prisma.releaseUploadSession.findUnique({ where: { id: upload.id } });
      if (current?.completedAt) throw new AppError("Upload session already finalized.", 409, "UPLOAD_ALREADY_FINALIZED");
      if (current?.finalizingAt) throw new AppError("Upload finalization is already in progress.", 409, "UPLOAD_FINALIZING");
      throw new AppError("Upload session expired.", 410, "UPLOAD_EXPIRED");
    }
    claimedForFinalize = true;

    const metadata = await inspectStoredUpload(upload.storageKey, upload.expectedSize);
    const draft = releaseDraftInputSchema.parse(upload.draftJson);

    const release = await prisma.$transaction(async (tx) => {
      const project = await tx.appProject.findFirst({
        where: { id: upload.projectId, ownerId: session.user.id, deletedAt: null },
      });
      if (!project) throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");
      if (project.androidPackageName && project.androidPackageName !== metadata.packageName) {
        throw new AppError(
          `This project is bound to ${project.androidPackageName}; the uploaded APK contains ${metadata.packageName}.`,
          409,
          "ANDROID_PACKAGE_MISMATCH",
        );
      }

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
          status: "PUBLISHED",
        },
      });
      await tx.appProject.update({ where: { id: project.id }, data: { androidPackageName: metadata.packageName } });
      await tx.buildAsset.create({
        data: {
          releaseId: createdRelease.id,
          storageKey: upload.storageKey,
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
      await tx.releaseUploadSession.update({
        where: { id: upload.id },
        data: { completedAt: new Date(), reservationReleasedAt: new Date(), finalizingAt: null },
      });
      await tx.builderProfile.update({
        where: { userId: session.user.id },
        data: {
          reservedStorageBytes: { decrement: upload.reservedBytes },
          usedStorageBytes: { increment: metadata.fileSizeBytes },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: session.user.id,
          action: "release.published",
          targetType: "Release",
          targetId: createdRelease.id,
          metadataJson: { packageName: metadata.packageName, versionCode: metadata.versionCode },
        },
      });
      return createdRelease;
    });

    finalized = true;
    const pendingUsers = await prisma.inviteClaim.findMany({
      where: { grantedAt: null, revokedAt: null, inviteLink: { projectId: upload.projectId } },
      distinct: ["userId"],
      select: { userId: true },
    });
    await Promise.all(pendingUsers.map(({ userId }) => reconcilePendingInviteGrants(userId, upload.projectId))).catch((error) => {
      logger.error("invite.post_publish_reconciliation_failed", { projectId: upload.projectId, error });
    });
    return NextResponse.json({
      releaseId: release.id,
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
  } catch (error) {
    if (!finalized && claimedForFinalize) {
      await releaseUploadReservation(sessionId).catch((cleanupError) => {
        logger.error("upload.reservation_cleanup_failed", { sessionId, error: cleanupError });
      });
      if (storageKey) await deleteObject(storageKey).catch((cleanupError) => {
        logger.error("upload.object_cleanup_failed", { sessionId, storageKey, error: cleanupError });
      });
    }
    return apiError(error, "Unable to finalize release upload.");
  }
}

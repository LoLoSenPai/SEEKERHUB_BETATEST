import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { inspectApkBuffer } from "@/src/lib/apk";
import { prisma } from "@/src/lib/db";
import { downloadObjectBytes, getBucketName, headObject } from "@/src/lib/storage/s3";
import { releaseDraftInputSchema } from "@/src/lib/validation";

const FINALIZE_RETRY_COUNT = 3;
const FINALIZE_RETRY_DELAY_MS = 450;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadAndInspectUpload(
  storageKey: string,
  expectedSize: bigint | null,
) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= FINALIZE_RETRY_COUNT; attempt += 1) {
    try {
      const head = await headObject(storageKey);
      const storageSize = head.ContentLength != null ? BigInt(head.ContentLength) : null;

      if (expectedSize && storageSize && storageSize !== expectedSize) {
        throw new Error(
          `Stored object size mismatch before validation. Expected ${expectedSize.toString()} bytes, got ${storageSize.toString()} bytes.`,
        );
      }

      const fileBuffer = await downloadObjectBytes(storageKey);
      const downloadedSize = BigInt(fileBuffer.byteLength);

      if (expectedSize && downloadedSize !== expectedSize) {
        throw new Error(
          `Downloaded object size mismatch before APK validation. Expected ${expectedSize.toString()} bytes, got ${downloadedSize.toString()} bytes.`,
        );
      }

      return await inspectApkBuffer(fileBuffer);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unable to inspect uploaded APK.");

      if (attempt < FINALIZE_RETRY_COUNT) {
        await wait(FINALIZE_RETRY_DELAY_MS);
        continue;
      }
    }
  }

  throw lastError ?? new Error("Unable to inspect uploaded APK.");
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const uploadSession = await prisma.releaseUploadSession.findUnique({
      where: { id: sessionId },
      include: {
        project: true,
      },
    });

    if (!uploadSession || uploadSession.userId !== session.user.id) {
      return NextResponse.json({ error: "Upload session not found." }, { status: 404 });
    }

    if (uploadSession.completedAt) {
      return NextResponse.json({ error: "Upload session already finalized." }, { status: 409 });
    }

    if (uploadSession.expiresAt < new Date()) {
      return NextResponse.json({ error: "Upload session expired." }, { status: 410 });
    }

    const fileMetadata = await downloadAndInspectUpload(
      uploadSession.storageKey,
      uploadSession.expectedSize,
    );
    const draft = releaseDraftInputSchema.parse(uploadSession.draftJson);

    const release = await prisma.$transaction(async (tx) => {
      const createdRelease = await tx.release.create({
        data: {
          projectId: uploadSession.projectId,
          createdById: session.user.id,
          versionName: draft.versionName,
          versionCode: draft.versionCode,
          changelog: draft.changelog,
          status: "PUBLISHED",
        },
      });

      await tx.buildAsset.create({
        data: {
          releaseId: createdRelease.id,
          storageKey: uploadSession.storageKey,
          bucket: getBucketName(),
          originalFileName: uploadSession.originalFileName,
          contentType: fileMetadata.detectedMimeType,
          fileSizeBytes: fileMetadata.fileSizeBytes,
          sha256Checksum: fileMetadata.sha256Checksum,
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
          walletEntries: {
            create: draft.accessPolicy.walletAllowlist.map((address) => ({
              address,
            })),
          },
        },
      });

      await tx.releaseUploadSession.update({
        where: { id: uploadSession.id },
        data: {
          completedAt: new Date(),
        },
      });

      return createdRelease;
    });

    return NextResponse.json({ releaseId: release.id });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to finalize release upload.",
      },
      { status: 400 },
    );
  }
}

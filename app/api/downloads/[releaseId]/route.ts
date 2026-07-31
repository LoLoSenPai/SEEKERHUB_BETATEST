import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { createSignedDownloadUrl } from "@/src/lib/storage/s3";
import { getTesterRelease } from "@/src/features/projects/queries";
import { apiError } from "@/src/lib/errors";

export async function GET(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await params;

  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }

    const ownedRelease = await prisma.release.findFirst({
      where: {
        id: releaseId,
        deletedAt: null,
        project: {
          ownerId: session.user.id,
          deletedAt: null,
        },
      },
      include: {
        buildAsset: true,
      },
    });

    if (ownedRelease?.buildAsset) {
      const builderProfile = await prisma.builderProfile.findUnique({ where: { userId: session.user.id } });
      if (session.user.isAnonymous || !session.user.emailVerified || builderProfile?.status !== "ACTIVE") {
        return NextResponse.json({ error: "An active builder account is required." }, { status: 403 });
      }
      const url = await createSignedDownloadUrl(ownedRelease.buildAsset.storageKey, ownedRelease.buildAsset.originalFileName);
      return NextResponse.redirect(url);
    }

    const testerRelease = await getTesterRelease(releaseId, session.user.id);

    if (!testerRelease?.decision.canDownload || !testerRelease.release.buildAsset) {
      return NextResponse.json({ error: "You do not have access to download this release." }, { status: 403 });
    }

    await prisma.downloadEvent.create({
      data: {
        releaseId,
        userId: session.user.id,
        deviceProfileId: testerRelease.user.deviceProfiles[0]?.id,
      },
    });

    const url = await createSignedDownloadUrl(
      testerRelease.release.buildAsset.storageKey,
      testerRelease.release.buildAsset.originalFileName,
    );
    return NextResponse.redirect(url);
  } catch (error) {
    return apiError(error, "Unable to generate download link.");
  }
}

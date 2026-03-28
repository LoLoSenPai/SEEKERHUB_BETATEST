import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { createSignedDownloadUrl } from "@/src/lib/storage/s3";
import { getTesterRelease } from "@/src/features/projects/queries";

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
        project: {
          ownerId: session.user.id,
        },
      },
      include: {
        buildAsset: true,
      },
    });

    if (ownedRelease?.buildAsset) {
      const url = await createSignedDownloadUrl(ownedRelease.buildAsset.storageKey);
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

    const url = await createSignedDownloadUrl(testerRelease.release.buildAsset.storageKey);
    return NextResponse.redirect(url);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to generate download link.",
      },
      { status: 400 },
    );
  }
}

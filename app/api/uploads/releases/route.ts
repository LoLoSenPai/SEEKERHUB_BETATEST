import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { assertApkName, sanitizeObjectName } from "@/src/lib/apk";
import { createSignedUploadUrl } from "@/src/lib/storage/s3";
import { createUploadSessionSchema } from "@/src/lib/validation";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = createUploadSessionSchema.parse(await request.json());
    assertApkName(body.fileName);

    const project = await prisma.appProject.findUnique({
      where: { id: body.projectId },
      select: { ownerId: true },
    });

    if (!project || project.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const key = `projects/${body.projectId}/release-upload-sessions/${nanoid()}/${sanitizeObjectName(body.fileName)}`;
    const uploadSession = await prisma.releaseUploadSession.create({
      data: {
        projectId: body.projectId,
        userId: session.user.id,
        storageKey: key,
        originalFileName: body.fileName,
        contentType: body.contentType,
        expectedSize: body.fileSize ? BigInt(body.fileSize) : null,
        draftJson: body.draft,
        expiresAt: new Date(Date.now() + 1000 * 60 * 15),
      },
    });

    const uploadUrl = await createSignedUploadUrl({
      key,
      contentType: body.contentType,
    });

    return NextResponse.json({
      sessionId: uploadSession.id,
      uploadUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create upload session.",
      },
      { status: 400 },
    );
  }
}

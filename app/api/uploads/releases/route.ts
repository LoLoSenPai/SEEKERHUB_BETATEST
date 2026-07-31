import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { assertApkName, sanitizeObjectName } from "@/src/lib/apk";
import { prisma } from "@/src/lib/db";
import { apiError, AppError } from "@/src/lib/errors";
import { reserveUploadQuota, releaseUploadReservation } from "@/src/lib/quota";
import { consumeRateLimit, RATE_LIMITS } from "@/src/lib/rate-limit";
import { requireBuilderApiSession } from "@/src/lib/session";
import { createSignedUploadUrl } from "@/src/lib/storage/s3";
import { createUploadSessionSchema } from "@/src/lib/validation";
import { logger } from "@/src/lib/logger";

export async function POST(request: Request) {
  let reservedSessionId: string | null = null;
  try {
    const session = await requireBuilderApiSession(request);
    await consumeRateLimit({ request, action: "release.upload", ...RATE_LIMITS.upload, userId: session.user.id });

    const body = createUploadSessionSchema.parse(await request.json());
    assertApkName(body.fileName);
    if (body.draft.projectId !== body.projectId) {
      throw new AppError("Release draft and upload project do not match.", 400, "PROJECT_SCOPE_MISMATCH");
    }
    const project = await prisma.appProject.findFirst({
      where: { id: body.projectId, ownerId: session.user.id, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");

    if (body.draft.accessPolicy.testerGroupId) {
      const group = await prisma.testerGroup.findFirst({
        where: { id: body.draft.accessPolicy.testerGroupId, projectId: project.id },
      });
      if (!group) throw new AppError("The selected tester group does not belong to this project.", 400, "INVALID_TESTER_GROUP");
    }

    const key = `projects/${body.projectId}/release-upload-sessions/${nanoid()}/${sanitizeObjectName(body.fileName)}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const uploadSession = await reserveUploadQuota({
      userId: session.user.id,
      projectId: body.projectId,
      bytes: body.fileSize,
      storageKey: key,
      fileName: body.fileName,
      contentType: body.contentType,
      draft: body.draft,
      expiresAt,
    });
    reservedSessionId = uploadSession.id;

    const uploadUrl = await createSignedUploadUrl({ key, contentType: body.contentType, contentLength: body.fileSize });
    return NextResponse.json({
      sessionId: uploadSession.id,
      uploadUrl,
      expiresAt,
      reservedBytes: body.fileSize,
    });
  } catch (error) {
    if (reservedSessionId) await releaseUploadReservation(reservedSessionId).catch((cleanupError) => {
      logger.error("upload.reservation_cleanup_failed", { sessionId: reservedSessionId, error: cleanupError });
    });
    return apiError(error, "Unable to create upload session.");
  }
}

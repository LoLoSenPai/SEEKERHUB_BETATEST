import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { getTesterRelease } from "@/src/features/projects/queries";
import { feedbackInputSchema } from "@/src/lib/validation";
import { apiError, AppError } from "@/src/lib/errors";
import { consumeRateLimit, RATE_LIMITS } from "@/src/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    }

    const body = feedbackInputSchema.parse(await request.json());
    await consumeRateLimit({
      request,
      action: "feedback.submit",
      ...RATE_LIMITS.feedback,
      userId: session.user.id,
      scope: body.releaseId,
    });
    const testerRelease = await getTesterRelease(body.releaseId, session.user.id);

    if (!testerRelease?.decision.canSubmitFeedback) {
      return NextResponse.json({ error: "You do not have access to submit feedback for this release." }, { status: 403 });
    }

    if (body.deviceProfileId) {
      const deviceProfile = await prisma.deviceProfile.findFirst({
        where: {
          id: body.deviceProfileId,
          userId: session.user.id,
        },
      });

      if (!deviceProfile) {
        return NextResponse.json({ error: "Device profile not found." }, { status: 404 });
      }
    }

    const feedback = await prisma.feedbackReport.create({
      data: {
        releaseId: body.releaseId,
        userId: session.user.id,
        deviceProfileId: body.deviceProfileId,
        title: body.title,
        description: body.description,
        severity: body.severity,
        deviceContextJson: body.deviceProfileId
          ? {
              source: "persisted-device-profile",
              profileId: body.deviceProfileId,
            }
          : undefined,
      },
      select: { id: true },
    });

    return NextResponse.json(feedback);
  } catch (error) {
    return apiError(error, "Unable to submit feedback.");
  }
}

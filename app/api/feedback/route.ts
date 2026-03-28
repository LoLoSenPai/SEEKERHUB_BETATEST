import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { getTesterRelease } from "@/src/features/projects/queries";
import { feedbackInputSchema } from "@/src/lib/validation";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = feedbackInputSchema.parse(await request.json());
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
        deviceContextJson: body.deviceContext ?? undefined,
      },
      select: { id: true },
    });

    return NextResponse.json(feedback);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to submit feedback.",
      },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { hashInviteToken } from "@/src/lib/invite";
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";
import { consumeRateLimit, RATE_LIMITS } from "@/src/lib/rate-limit";
import { apiError, AppError } from "@/src/lib/errors";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    }

    await consumeRateLimit({
      request,
      action: "invite.claim",
      ...RATE_LIMITS.claim,
    });

    const invite = await prisma.$transaction(async (tx) => {
      const freshInvite = await tx.inviteLink.findFirst({
        where: {
          tokenHash: hashInviteToken(token),
          project: { deletedAt: null },
          OR: [{ releaseId: null }, { release: { deletedAt: null } }],
        },
      });
      if (!freshInvite) throw new AppError("Invite not found.", 404, "INVITE_NOT_FOUND");
      if (freshInvite.revokedAt) throw new AppError("Invite revoked.", 410, "INVITE_REVOKED");
      if (freshInvite.expiresAt && freshInvite.expiresAt <= new Date()) {
        throw new AppError("Invite expired.", 410, "INVITE_EXPIRED");
      }

      const testerAccess = await tx.testerAccess.upsert({
        where: { projectId_userId: { projectId: freshInvite.projectId, userId: session.user.id } },
        create: { projectId: freshInvite.projectId, userId: session.user.id },
        update: {},
      });
      if (testerAccess.revokedAt) {
        throw new AppError("Your tester access to this project was revoked.", 403, "TESTER_REVOKED");
      }

      const existingClaim = await tx.inviteClaim.findUnique({
        where: { inviteLinkId_userId: { inviteLinkId: freshInvite.id, userId: session.user.id } },
      });
      if (existingClaim?.revokedAt) {
        throw new AppError("Your tester access to this project was revoked.", 403, "TESTER_REVOKED");
      }
      if (!existingClaim) {
        await tx.inviteClaim.create({ data: { inviteLinkId: freshInvite.id, userId: session.user.id } });
      }
      return freshInvite;
    });

    await reconcilePendingInviteGrants(session.user.id, invite.projectId);

    return NextResponse.json({
      ok: true,
      redirectTo: invite.releaseId ? `/tester/releases/${invite.releaseId}` : "/tester",
    });
  } catch (error) {
    return apiError(error, "Unable to claim invite.");
  }
}

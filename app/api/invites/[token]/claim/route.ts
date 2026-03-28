import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { hashInviteToken } from "@/src/lib/invite";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const invite = await prisma.inviteLink.findFirst({
      where: { tokenHash: hashInviteToken(token) },
      include: {
        inviteClaims: true,
      },
    });

    if (!invite) {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 });
    }

    if (invite.revokedAt) {
      return NextResponse.json({ error: "Invite revoked." }, { status: 410 });
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return NextResponse.json({ error: "Invite expired." }, { status: 410 });
    }

    if (invite.maxUses && invite.inviteClaims.length >= invite.maxUses) {
      return NextResponse.json({ error: "Invite reached its maximum number of claims." }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      const existingClaim = await tx.inviteClaim.findFirst({
        where: {
          inviteLinkId: invite.id,
          userId: session.user.id,
        },
      });

      if (!existingClaim) {
        await tx.inviteClaim.create({
          data: {
            inviteLinkId: invite.id,
            userId: session.user.id,
          },
        });
      }

      const existingMembership = await tx.testerMembership.findFirst({
        where: {
          projectId: invite.projectId,
          testerGroupId: invite.testerGroupId ?? null,
          userId: session.user.id,
        },
      });

      if (!existingMembership) {
        await tx.testerMembership.create({
          data: {
            projectId: invite.projectId,
            testerGroupId: invite.testerGroupId,
            userId: session.user.id,
            source: "INVITE_LINK",
            inviteLinkId: invite.id,
          },
        });
      }
    });

    return NextResponse.json({
      ok: true,
      redirectTo: invite.releaseId ? `/tester/releases/${invite.releaseId}` : "/tester",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to claim invite.",
      },
      { status: 400 },
    );
  }
}

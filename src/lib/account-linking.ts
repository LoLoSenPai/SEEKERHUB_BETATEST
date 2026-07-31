import { prisma } from "@/src/lib/db";

export async function transferAnonymousAccount(anonymousUserId: string, durableUserId: string) {
  if (anonymousUserId === durableUserId) return;

  await prisma.$transaction(async (tx) => {
    const claims = await tx.inviteClaim.findMany({ where: { userId: anonymousUserId } });
    for (const claim of claims) {
      const existing = await tx.inviteClaim.findUnique({
        where: { inviteLinkId_userId: { inviteLinkId: claim.inviteLinkId, userId: durableUserId } },
      });
      if (existing) {
        await tx.inviteClaim.update({
          where: { id: existing.id },
          data: {
            grantedAt: existing.grantedAt ?? claim.grantedAt,
            revokedAt: existing.revokedAt ?? claim.revokedAt,
          },
        });
        await tx.inviteClaim.delete({ where: { id: claim.id } });
      } else {
        await tx.inviteClaim.update({ where: { id: claim.id }, data: { userId: durableUserId } });
      }
    }

    const memberships = await tx.testerMembership.findMany({ where: { userId: anonymousUserId } });
    for (const membership of memberships) {
      const existing = await tx.testerMembership.findFirst({
        where: {
          projectId: membership.projectId,
          testerGroupId: membership.testerGroupId,
          userId: durableUserId,
        },
      });
      if (existing) {
        await tx.testerMembership.update({
          where: { id: existing.id },
          data: { revokedAt: existing.revokedAt ?? membership.revokedAt },
        });
        await tx.testerMembership.delete({ where: { id: membership.id } });
      } else {
        await tx.testerMembership.update({ where: { id: membership.id }, data: { userId: durableUserId } });
      }
    }

    const testerAccesses = await tx.testerAccess.findMany({ where: { userId: anonymousUserId } });
    for (const access of testerAccesses) {
      const existing = await tx.testerAccess.findUnique({
        where: { projectId_userId: { projectId: access.projectId, userId: durableUserId } },
      });
      if (existing) {
        await tx.testerAccess.update({
          where: { id: existing.id },
          data: { revokedAt: existing.revokedAt ?? access.revokedAt },
        });
        await tx.testerAccess.delete({ where: { id: access.id } });
      } else {
        await tx.testerAccess.update({ where: { id: access.id }, data: { userId: durableUserId } });
      }
    }

    const wallets = await tx.wallet.findMany({ where: { userId: anonymousUserId } });
    for (const wallet of wallets) {
      await tx.wallet.update({ where: { id: wallet.id }, data: { userId: durableUserId } });
    }

    await Promise.all([
      tx.feedbackReport.updateMany({ where: { userId: anonymousUserId }, data: { userId: durableUserId } }),
      tx.downloadEvent.updateMany({ where: { userId: anonymousUserId }, data: { userId: durableUserId } }),
      tx.releaseViewEvent.updateMany({ where: { userId: anonymousUserId }, data: { userId: durableUserId } }),
      tx.deviceProfile.updateMany({ where: { userId: anonymousUserId }, data: { userId: durableUserId } }),
      tx.walletChallenge.deleteMany({ where: { userId: anonymousUserId } }),
    ]);

    await tx.auditLog.create({
      data: {
        actorUserId: durableUserId,
        action: "tester.account_upgraded",
        targetType: "User",
        targetId: durableUserId,
        metadataJson: { anonymousUserId },
      },
    });
  });
}

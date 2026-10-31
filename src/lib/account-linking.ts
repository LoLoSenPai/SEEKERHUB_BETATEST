import { prisma } from "@/src/lib/db";
import { Prisma } from "@prisma/client";
import { AppError } from "@/src/lib/errors";
import { isTransactionConflict, isUniqueConstraintError } from "@/src/lib/prisma-errors";

export async function transferAnonymousAccountInTransaction(tx: Prisma.TransactionClient, anonymousUserId: string, durableUserId: string) {
  if (anonymousUserId === durableUserId) return;
  const ids = [anonymousUserId, durableUserId].sort();
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
  const source = await tx.user.findUnique({ where: { id: anonymousUserId }, include: { builderProfile: true, accounts: { select: { id: true }, take: 1 } } });
  // Better Auth may invoke its post-sign-in hook after the wallet transaction already merged this guest.
  if (!source) return;
  if (!source.isAnonymous || source.builderProfile || source.accounts.length) {
    throw new AppError("Only a guest account can be transferred. Sign out to switch accounts.", 409, "ACCOUNT_SWITCH_REQUIRED");
  }
  if (!(await tx.user.findUnique({ where: { id: durableUserId }, select: { id: true } }))) {
    throw new AppError("The destination account no longer exists.", 409, "ACCOUNT_CHANGED");
  }

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
}

export async function transferAnonymousAccount(anonymousUserId: string, durableUserId: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await prisma.$transaction(
        (tx) => transferAnonymousAccountInTransaction(tx, anonymousUserId, durableUserId),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return;
    } catch (error) {
      if (attempt < 3 && (isTransactionConflict(error) || isUniqueConstraintError(error))) continue;
      throw error;
    }
  }
}

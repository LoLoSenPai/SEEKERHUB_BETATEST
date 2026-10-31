import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { isTransactionConflict, isUniqueConstraintError } from "@/src/lib/prisma-errors";

export async function reconcilePendingInviteGrants(userId: string, projectId?: string) {
  // This is only a work list. Every authorization input is read again below.
  const claims = await prisma.inviteClaim.findMany({
    where: { userId, grantedAt: null, revokedAt: null, inviteLink: { projectId } },
    select: { id: true, inviteLinkId: true },
  });

  for (const claim of claims) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await prisma.$transaction(async (tx) => {
          // Serialize seat allocation with other grants and share-link closure.
          await tx.$queryRaw`SELECT "id" FROM "InviteLink" WHERE "id" = ${claim.inviteLinkId} FOR UPDATE`;
          const fresh = await tx.inviteClaim.findUnique({
            where: { id: claim.id },
            include: { inviteLink: { include: { project: true, testerGroup: true } } },
          });
          if (!fresh || fresh.userId !== userId || fresh.grantedAt || fresh.revokedAt) return;
          const invite = fresh.inviteLink;
          const now = new Date();
          if ((projectId && invite.projectId !== projectId) || invite.project.deletedAt || invite.revokedAt ||
            (invite.expiresAt && invite.expiresAt <= now)) return;
          if (invite.testerGroupId && invite.testerGroup?.projectId !== invite.projectId) return;

          const user = await tx.user.findUnique({
            where: { id: userId },
            include: {
              wallets: true,
              testerAccesses: { where: { projectId: invite.projectId } },
              testerMemberships: { where: { projectId: invite.projectId } },
            },
          });
          if (!user || user.testerAccesses.some((access) => access.revokedAt)) return;
          const inviteMembership = invite.testerGroupId
            ? user.testerMemberships.find((membership) => membership.testerGroupId === invite.testerGroupId)
            : undefined;
          // An invite must never silently restore a membership removed by a builder.
          if (inviteMembership?.revokedAt) return;

          const releases = await tx.release.findMany({
            where: { projectId: invite.projectId, id: invite.releaseId ?? undefined, status: "PUBLISHED", deletedAt: null },
            include: { accessPolicy: { include: { walletEntries: true } } },
          });
          const eligible = releases.some(({ accessPolicy: policy }) => {
            if (!policy) return false;
            if (policy.testerGroupId && policy.testerGroupId !== invite.testerGroupId &&
              !user.testerMemberships.some((membership) => membership.testerGroupId === policy.testerGroupId && !membership.revokedAt)) return false;
            if (policy.requireLinkedWallet && !user.wallets.length) return false;
            if (policy.walletEntries.length && !user.wallets.some((wallet) =>
              policy.walletEntries.some((entry) => entry.address === wallet.address))) return false;
            return !policy.requireVerifiedSeeker || user.wallets.some((wallet) =>
              wallet.seekerGenesisVerificationExpiresAt && wallet.seekerGenesisVerificationExpiresAt > new Date());
          });
          if (!eligible) return;

          if (invite.maxUses !== null) {
            const occupied = await tx.inviteClaim.count({ where: { inviteLinkId: invite.id, grantedAt: { not: null } } });
            if (occupied >= invite.maxUses) return;
          }
          const grantedAt = new Date();
          if (invite.expiresAt && invite.expiresAt <= grantedAt) return;
          await tx.inviteClaim.update({ where: { id: fresh.id }, data: { grantedAt } });
          if (invite.testerGroupId && !inviteMembership) {
            await tx.testerMembership.create({
              data: { projectId: invite.projectId, testerGroupId: invite.testerGroupId, userId, source: "INVITE_LINK", inviteLinkId: invite.id },
            });
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        if ((isTransactionConflict(error) || isUniqueConstraintError(error)) && attempt < 2) continue;
        throw error;
      }
    }
  }
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";

function walletMeetsPolicy(
  policy: {
    requireLinkedWallet: boolean;
    requireVerifiedSeeker: boolean;
    walletEntries: { address: string }[];
  },
  wallets: Array<{
    address: string;
    seekerGenesisVerificationExpiresAt: Date | null;
  }>,
  now: Date,
) {
  if (policy.requireLinkedWallet && wallets.length === 0) return false;
  if (policy.walletEntries.length > 0 && !wallets.some((wallet) => policy.walletEntries.some((entry) => entry.address === wallet.address))) {
    return false;
  }
  if (
    policy.requireVerifiedSeeker &&
    !wallets.some((wallet) => wallet.seekerGenesisVerificationExpiresAt && wallet.seekerGenesisVerificationExpiresAt > now)
  ) {
    return false;
  }
  return true;
}

export async function reconcilePendingInviteGrants(userId: string, projectId?: string) {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallets: true,
      testerAccesses: true,
      testerMemberships: { where: { revokedAt: null } },
      inviteClaims: {
        where: { grantedAt: null, revokedAt: null },
        include: { inviteLink: true },
      },
    },
  });
  if (!user) return;

  for (const claim of user.inviteClaims) {
    const invite = claim.inviteLink;
    if (projectId && invite.projectId !== projectId) continue;
    if (user.testerAccesses.some((access) => access.projectId === invite.projectId && access.revokedAt)) continue;
    const releases = await prisma.release.findMany({
      where: {
        projectId: invite.projectId,
        id: invite.releaseId ?? undefined,
        status: "PUBLISHED",
        deletedAt: null,
      },
      include: { accessPolicy: { include: { walletEntries: true } } },
    });

    const eligible = releases.some((release) => {
      const policy = release.accessPolicy;
      if (!policy) return false;
      const inRequiredGroup =
        !policy.testerGroupId ||
        invite.testerGroupId === policy.testerGroupId ||
        user.testerMemberships.some((membership) => membership.testerGroupId === policy.testerGroupId);
      return inRequiredGroup && walletMeetsPolicy(policy, user.wallets, now);
    });
    if (!eligible) continue;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await prisma.$transaction(
          async (tx) => {
            const fresh = await tx.inviteClaim.findUnique({ where: { id: claim.id }, include: { inviteLink: true } });
            if (!fresh || fresh.grantedAt || fresh.revokedAt) return;

            if (fresh.inviteLink.maxUses) {
              const occupied = await tx.inviteClaim.count({
                where: { inviteLinkId: fresh.inviteLinkId, grantedAt: { not: null } },
              });
              if (occupied >= fresh.inviteLink.maxUses) return;
            }

            await tx.inviteClaim.update({ where: { id: fresh.id }, data: { grantedAt: new Date() } });
            if (fresh.inviteLink.testerGroupId) {
              const membership = await tx.testerMembership.findFirst({
                where: {
                  projectId: fresh.inviteLink.projectId,
                  testerGroupId: fresh.inviteLink.testerGroupId,
                  userId,
                },
              });
              if (membership) {
                await tx.testerMembership.update({ where: { id: membership.id }, data: { revokedAt: null } });
              } else {
                await tx.testerMembership.create({
                  data: {
                    projectId: fresh.inviteLink.projectId,
                    testerGroupId: fresh.inviteLink.testerGroupId,
                    userId,
                    source: "INVITE_LINK",
                    inviteLinkId: fresh.inviteLink.id,
                  },
                });
              }
            }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt === 0) continue;
        throw error;
      }
    }
  }
}

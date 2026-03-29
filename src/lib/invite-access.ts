import { Prisma } from "@prisma/client";
import type { AccessPolicy, DeviceProfile, TesterMembership, Wallet } from "@prisma/client";
import { prisma } from "@/src/lib/db";

type InviteClaimWithLink = {
  id: string;
  createdAt: Date;
  grantedAt: Date | null;
  inviteLink: {
    id: string;
    projectId: string;
    releaseId: string | null;
    maxUses: number | null;
  };
};

type ResolveInviteAcceptanceInput = {
  userId: string;
  policy: AccessPolicy & {
    walletEntries: { address: string }[];
  };
  testerMemberships: TesterMembership[];
  inviteClaims: InviteClaimWithLink[];
  wallets: Wallet[];
  deviceProfile: DeviceProfile | null;
  releaseId: string;
  projectId: string;
};

function claimMatchesRelease(claim: InviteClaimWithLink, projectId: string, releaseId: string) {
  return (
    claim.inviteLink.projectId === projectId &&
    (claim.inviteLink.releaseId === null || claim.inviteLink.releaseId === releaseId)
  );
}

function meetsPostInviteRequirements(input: Omit<ResolveInviteAcceptanceInput, "userId" | "inviteClaims">) {
  const { policy, testerMemberships, wallets, deviceProfile } = input;

  if (policy.testerGroupId) {
    const inGroup = testerMemberships.some((membership) => membership.testerGroupId === policy.testerGroupId);
    if (!inGroup) {
      return false;
    }
  }

  if (policy.requireLinkedWallet) {
    if (!wallets.length) {
      return false;
    }

    if (policy.walletEntries.length > 0) {
      const allowed = wallets.some((wallet) =>
        policy.walletEntries.some((entry) => entry.address.toLowerCase() === wallet.address.toLowerCase()),
      );

      if (!allowed) {
        return false;
      }
    }
  }

  if (policy.requireSolanaMobile && !deviceProfile?.isSolanaMobileCapable) {
    return false;
  }

  if (policy.requireVerifiedSeeker) {
    const verifiedSeekerWallet = wallets.some((wallet) => Boolean(wallet.seekerGenesisVerifiedAt));
    if (!verifiedSeekerWallet) {
      return false;
    }
  }

  return true;
}

async function tryGrantInviteSeat(claim: InviteClaimWithLink) {
  if (!claim.inviteLink.maxUses) {
    return null;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const grantedAt = new Date();

      const granted = await prisma.$transaction(
        async (tx) => {
          const freshClaim = await tx.inviteClaim.findUnique({
            where: { id: claim.id },
            include: {
              inviteLink: true,
            },
          });

          if (!freshClaim?.inviteLink.maxUses) {
            return null;
          }

          if (freshClaim.grantedAt) {
            return freshClaim.grantedAt;
          }

          const grantedCount = await tx.inviteClaim.count({
            where: {
              inviteLinkId: freshClaim.inviteLinkId,
              grantedAt: {
                not: null,
              },
            },
          });

          if (grantedCount >= freshClaim.inviteLink.maxUses) {
            return false;
          }

          await tx.inviteClaim.update({
            where: { id: freshClaim.id },
            data: { grantedAt },
          });

          return grantedAt;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      return granted;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        attempt === 0 &&
        ["P2034", "P2028"].includes(error.code)
      ) {
        continue;
      }

      throw error;
    }
  }

  return false;
}

export async function resolveInviteAcceptanceForRelease<TInviteClaim extends InviteClaimWithLink>(
  input: Omit<ResolveInviteAcceptanceInput, "inviteClaims"> & {
    inviteClaims: TInviteClaim[];
  },
) {
  const { policy, inviteClaims, projectId, releaseId } = input;

  if (!policy.requireInviteAcceptance) {
    return {
      inviteClaims,
      inviteCapacityReason: null as string | null,
    };
  }

  const matchingClaims = inviteClaims
    .filter((claim) => claimMatchesRelease(claim, projectId, releaseId))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

  const hasAcceptedInvite = matchingClaims.some((claim) => !claim.inviteLink.maxUses || Boolean(claim.grantedAt));

  if (hasAcceptedInvite || matchingClaims.length === 0) {
    return {
      inviteClaims,
      inviteCapacityReason: null as string | null,
    };
  }

  if (!meetsPostInviteRequirements(input)) {
    return {
      inviteClaims,
      inviteCapacityReason: null as string | null,
    };
  }

  for (const claim of matchingClaims) {
    const grantedAt = await tryGrantInviteSeat(claim);

    if (grantedAt instanceof Date) {
      return {
        inviteClaims: inviteClaims.map((candidate) =>
          candidate.id === claim.id
            ? {
                ...candidate,
                grantedAt,
              } satisfies TInviteClaim
            : candidate,
        ),
        inviteCapacityReason: null as string | null,
      };
    }

    if (grantedAt === null) {
      return {
        inviteClaims,
        inviteCapacityReason: null as string | null,
      };
    }
  }

  return {
    inviteClaims,
    inviteCapacityReason: "This invite has already been granted to the maximum number of eligible testers.",
  };
}

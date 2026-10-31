import type { Prisma } from "@prisma/client";

type IdentityEvent = {
  userId: string | null;
  user: { isAnonymous: boolean } | null;
};

// Identity is the current account, including events moved by a guest-account merge.
// Null identities are deliberately not inferred from IPs or device profiles.
export function summarizeIdentities(events: readonly IdentityEvent[]) {
  const accounts = new Set<string>();
  const guests = new Set<string>();
  for (const event of events) {
    if (!event.userId || !event.user) continue;
    (event.user.isAnonymous ? guests : accounts).add(event.userId);
  }
  return { accounts: accounts.size, guests: guests.size, total: accounts.size + guests.size };
}

type Claim = { userId: string; grantedAt: Date | null; revokedAt: Date | null };

export function summarizeClaims(claims: readonly Claim[]) {
  const active = claims.filter((claim) => claim.grantedAt && !claim.revokedAt);
  return {
    claims: claims.length,
    pendingClaims: claims.filter((claim) => !claim.grantedAt && !claim.revokedAt).length,
    revokedClaims: claims.filter((claim) => claim.revokedAt).length,
    grantedPlaces: active.length,
    // Revocation does not refund invite capacity in reconcilePendingInviteGrants.
    occupiedPlaces: claims.filter((claim) => claim.grantedAt).length,
    uniqueTesters: new Set(active.map((claim) => claim.userId)).size,
  };
}

// Mirrors claim scope in evaluateReleaseAccess, not grant eligibility. Closed or
// expired share links do not remove existing claims; inherited scope needs a grant.
export function releaseAnalyticsClaimScope(release: {
  id: string; projectId: string; publishedAt: Date;
}): Prisma.InviteClaimWhereInput {
  return {
    inviteLink: { projectId: release.projectId },
    OR: [
      { inviteLink: { releaseId: null } },
      { inviteLink: { releaseId: release.id } },
      {
        grantedAt: { not: null },
        inviteLink: { release: {
          publishedAt: { gte: release.publishedAt },
          accessPolicy: { allowPreviousReleases: true },
        } },
      },
    ],
  };
}

import type { AccessPolicy, DeviceProfile, TesterMembership, Wallet } from "@prisma/client";

export type AccessReasonCode =
  | "TESTER_REVOKED"
  | "INVITE_REQUIRED"
  | "INVITE_PENDING_ELIGIBILITY"
  | "GROUP_REQUIRED"
  | "WALLET_REQUIRED"
  | "WALLET_NOT_ALLOWLISTED"
  | "SGT_VERIFICATION_REQUIRED"
  | "SGT_VERIFICATION_EXPIRED"
  | "SOLANA_MOBILE_ADVISORY";

export type AccessReason = {
  code: AccessReasonCode;
  message: string;
  blocking: boolean;
};

type EvaluateReleaseAccessInput = {
  policy: AccessPolicy & { walletEntries: { address: string }[] };
  testerMemberships: TesterMembership[];
  inviteClaims: Array<{
    grantedAt?: Date | null;
    revokedAt?: Date | null;
    inviteLink: {
      projectId: string;
      releaseId: string | null;
      revokedAt?: Date | null;
      expiresAt?: Date | null;
      release?: {
        publishedAt: Date;
        accessPolicy: { allowPreviousReleases: boolean } | null;
      } | null;
    };
  }>;
  wallets: Wallet[];
  deviceProfile: DeviceProfile | null;
  releaseId: string;
  projectId: string;
  releasePublishedAt?: Date;
  testerAccessRevoked?: boolean;
  now?: Date;
};

export type AccessDecision = {
  canViewMetadata: boolean;
  canDownload: boolean;
  canSubmitFeedback: boolean;
  reasons: AccessReason[];
};

export function evaluateReleaseAccess(input: EvaluateReleaseAccessInput): AccessDecision {
  if (input.testerAccessRevoked) {
    return {
      canViewMetadata: false,
      canDownload: false,
      canSubmitFeedback: false,
      reasons: [{ code: "TESTER_REVOKED", message: "Your tester access to this project was revoked.", blocking: true }],
    };
  }

  const reasons: AccessReason[] = [];
  const { policy, testerMemberships, inviteClaims, wallets, deviceProfile, releaseId, projectId } = input;
  const now = input.now ?? new Date();
  const matchingClaims = inviteClaims.filter(
    (claim) => {
      if (claim.revokedAt || claim.inviteLink.projectId !== projectId) return false;
      if (claim.inviteLink.releaseId === null || claim.inviteLink.releaseId === releaseId) return true;

      const sourceRelease = claim.inviteLink.release;
      return Boolean(
        claim.grantedAt &&
          sourceRelease?.accessPolicy?.allowPreviousReleases &&
          input.releasePublishedAt &&
          sourceRelease.publishedAt >= input.releasePublishedAt,
      );
    },
  );
  const hasClaim = matchingClaims.length > 0;
  const hasGrantedClaim = matchingClaims.some((claim) => Boolean(claim.grantedAt));

  if (policy.requireInviteAcceptance && !hasClaim) {
    reasons.push({ code: "INVITE_REQUIRED", message: "Accept an invitation to access this release.", blocking: true });
  } else if (policy.requireInviteAcceptance && !hasGrantedClaim) {
    reasons.push({
      code: "INVITE_PENDING_ELIGIBILITY",
      message: "Complete the release requirements to receive an available tester place.",
      blocking: true,
    });
  }

  if (policy.testerGroupId) {
    const inGroup = testerMemberships.some(
      (membership) => !membership.revokedAt && membership.testerGroupId === policy.testerGroupId,
    );
    if (!inGroup) reasons.push({ code: "GROUP_REQUIRED", message: "This release is restricted to a tester group.", blocking: true });
  }

  if (policy.requireLinkedWallet && wallets.length === 0) {
    reasons.push({ code: "WALLET_REQUIRED", message: "Link a Solana wallet to continue.", blocking: true });
  }

  if (policy.walletEntries.length > 0) {
    const allowed = wallets.some((wallet) => policy.walletEntries.some((entry) => entry.address === wallet.address));
    if (!allowed) {
      reasons.push({ code: "WALLET_NOT_ALLOWLISTED", message: "Your linked wallet is not on this release allowlist.", blocking: true });
    }
  }

  if (policy.requireVerifiedSeeker) {
    const everVerified = wallets.some((wallet) => Boolean(wallet.seekerGenesisVerifiedAt));
    const currentlyVerified = wallets.some(
      (wallet) => wallet.seekerGenesisVerificationExpiresAt && wallet.seekerGenesisVerificationExpiresAt > now,
    );
    if (!currentlyVerified) {
      reasons.push({
        code: everVerified ? "SGT_VERIFICATION_EXPIRED" : "SGT_VERIFICATION_REQUIRED",
        message: everVerified
          ? "Your Seeker verification expired. Verify the linked wallet again."
          : "Verify Seeker Genesis Token ownership with a linked wallet.",
        blocking: true,
      });
    }
  }

  if (policy.requireSolanaMobile && !deviceProfile?.isSolanaMobileCapable) {
    reasons.push({
      code: "SOLANA_MOBILE_ADVISORY",
      message: "This build is intended for a Solana Mobile capable device.",
      blocking: false,
    });
  }

  const hasBlockingReason = reasons.some((reason) => reason.blocking);
  const canViewMetadata = !policy.requireInviteAcceptance || hasClaim;

  return {
    canViewMetadata,
    canDownload: canViewMetadata && !hasBlockingReason,
    canSubmitFeedback: canViewMetadata && !hasBlockingReason,
    reasons,
  };
}

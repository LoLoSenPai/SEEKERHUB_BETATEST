import type { AccessPolicy, DeviceProfile, TesterMembership, Wallet } from "@prisma/client";

type EvaluateReleaseAccessInput = {
  policy: AccessPolicy & {
    walletEntries: { address: string }[];
  };
  testerMemberships: TesterMembership[];
  inviteClaims: Array<{
    grantedAt?: Date | null;
    inviteLink: {
      projectId: string;
      releaseId: string | null;
      maxUses?: number | null;
    };
  }>;
  wallets: Wallet[];
  deviceProfile: DeviceProfile | null;
  releaseId: string;
  projectId: string;
};

export type AccessDecision = {
  canView: boolean;
  canDownload: boolean;
  canSubmitFeedback: boolean;
  reasons: string[];
};

export function evaluateReleaseAccess(input: EvaluateReleaseAccessInput): AccessDecision {
  const reasons: string[] = [];
  const { policy, testerMemberships, inviteClaims, wallets, deviceProfile, releaseId, projectId } = input;

  const hasInviteClaim = !policy.requireInviteAcceptance
    ? true
    : inviteClaims.some(
        (claim) =>
          claim.inviteLink.projectId === projectId &&
          (claim.inviteLink.releaseId === null || claim.inviteLink.releaseId === releaseId) &&
          (!claim.inviteLink.maxUses || Boolean(claim.grantedAt)),
      );

  if (!hasInviteClaim && policy.requireInviteAcceptance) {
    reasons.push("An accepted invite is required for this release.");
  }

  if (policy.testerGroupId) {
    const inGroup = testerMemberships.some((membership) => membership.testerGroupId === policy.testerGroupId);
    if (!inGroup) {
      reasons.push("You are not in the tester group assigned to this release.");
    }
  }

  if (policy.requireLinkedWallet) {
    if (!wallets.length) {
      reasons.push("A linked Solana wallet is required.");
    }

    if (policy.walletEntries.length > 0) {
      const allowed = wallets.some((wallet) =>
        policy.walletEntries.some((entry) => entry.address.toLowerCase() === wallet.address.toLowerCase()),
      );

      if (!allowed) {
        reasons.push("Your linked wallet is not on this release allowlist.");
      }
    }
  }

  if (policy.requireSolanaMobile && !deviceProfile?.isSolanaMobileCapable) {
    reasons.push("This release requires a Solana Mobile capable browser or device.");
  }

  if (policy.requireVerifiedSeeker) {
    const verifiedSeekerWallet = wallets.some((wallet) => Boolean(wallet.seekerGenesisVerifiedAt));
    if (!verifiedSeekerWallet) {
      reasons.push("A verified Seeker wallet is required.");
    }
  }

  return {
    canView: reasons.length === 0,
    canDownload: reasons.length === 0,
    canSubmitFeedback: reasons.length === 0,
    reasons,
  };
}

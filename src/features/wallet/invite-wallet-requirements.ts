type WalletPolicy = {
  requireLinkedWallet: boolean;
  requireVerifiedSeeker: boolean;
  _count: { walletEntries: number };
};

export function getInviteWalletRequirements(policies: (WalletPolicy | null | undefined)[]) {
  const needsWallet = (policy: WalletPolicy | null | undefined) => Boolean(
    policy && (policy.requireLinkedWallet || policy.requireVerifiedSeeker || policy._count.walletEntries > 0),
  );
  return {
    walletRecommended: policies.some(needsWallet),
    walletRequired: policies.length > 0 && policies.every(needsWallet),
    seekerRecommended: policies.some((policy) => policy?.requireVerifiedSeeker),
    seekerRequired: policies.length > 0 && policies.every((policy) => policy?.requireVerifiedSeeker),
  };
}

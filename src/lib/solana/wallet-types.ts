export type WalletSgtContext = { releaseId: string } | { inviteToken: string };
export type WalletAuthPurpose = "SIGN_IN" | "SIGN_IN_AND_VERIFY_SGT";
export type WalletSgtOutcome = {
  status: "verified" | "not_found" | "unavailable" | "conflict" | "rate_limited" | "error";
  verified: boolean;
  mintAddress: string | null;
  expiresAt: Date | string | null;
  code?: string;
  message?: string;
};

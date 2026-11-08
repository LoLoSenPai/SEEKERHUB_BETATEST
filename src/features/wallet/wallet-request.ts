import bs58 from "bs58";
import type { WalletAuthPurpose, WalletSgtContext, WalletSgtOutcome } from "@/src/lib/solana/wallet-types";

export type WalletPurpose = WalletAuthPurpose | "VERIFY_SGT";
export type { WalletSgtContext, WalletSgtOutcome };

export class WalletRequestError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(code === "ACCOUNT_SWITCH_REQUIRED"
      ? "This wallet belongs to another account. Sign out of your current account, then continue with this wallet. Accounts have not been switched or merged."
      : message);
  }
}

async function post(path: string, body: object) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new WalletRequestError(payload?.message ?? payload?.error ?? "Wallet request failed. Please try again.", payload?.code);
  }
  return payload;
}

export async function requestWalletAction({ address, signMessage, getAddress, purpose, sgtContext }: {
  address: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  getAddress: () => string | undefined;
  purpose: WalletPurpose;
  sgtContext?: WalletSgtContext;
}) {
  if ((purpose === "SIGN_IN_AND_VERIFY_SGT") !== Boolean(sgtContext)) {
    throw new WalletRequestError("Choose an invitation or release requiring an SGT check before combined sign-in.");
  }
  const assertSameWallet = () => {
    if (getAddress() !== address) throw new WalletRequestError("Wallet changed. Select your wallet and try again.");
  };
  assertSameWallet();
  const challenge = await post("/api/wallet/challenge", { address, purpose, ...(sgtContext ? { sgtContext } : {}) });
  if (typeof challenge.challengeId !== "string" || typeof challenge.message !== "string") {
    throw new WalletRequestError("Invalid wallet challenge. Please try again.");
  }
  assertSameWallet();
  const signature = await signMessage(new TextEncoder().encode(challenge.message));
  assertSameWallet();
  const payload = await post(purpose !== "VERIFY_SGT" ? "/api/auth/sign-in/solana-wallet" : "/api/wallet/verify-seeker", {
    challengeId: challenge.challengeId,
    address,
    signature: bs58.encode(signature),
    ...(purpose === "SIGN_IN_AND_VERIFY_SGT" ? { purpose } : {}),
  });
  if (purpose !== "VERIFY_SGT" && payload.success !== true) throw new WalletRequestError("Wallet sign-in failed. Please try again.");
  if (purpose === "VERIFY_SGT" && payload.verified !== true) {
    throw new WalletRequestError("No Seeker Genesis Token found in this wallet. You can retry or select another wallet.");
  }
  return payload;
}

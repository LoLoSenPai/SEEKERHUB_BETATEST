import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

export function buildWalletChallengeMessage(input: {
  address: string;
  nonce: string;
  appUrl: string;
  purpose: "LINK" | "VERIFY_SGT" | "SIGN_IN";
  expiresAt: Date;
}) {
  const url = new URL(input.appUrl);
  const statements = {
    LINK: "Link this wallet to your SeekerHub tester account.",
    VERIFY_SGT: "Verify Seeker Genesis Token ownership for private beta access.",
    SIGN_IN: "Sign in to recover your SeekerHub tester account.",
  } as const;

  return [
    `${url.host} wants you to sign in with your Solana account:`,
    input.address,
    "",
    statements[input.purpose],
    "",
    `URI: ${url.origin}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${input.nonce}`,
    `Issued At: ${new Date().toISOString()}`,
    `Expiration Time: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}

export function verifySolanaSignature({
  address,
  message,
  signature,
}: {
  address: string;
  message: string;
  signature: Uint8Array;
}) {
  const publicKey = new PublicKey(address);
  return nacl.sign.detached.verify(new TextEncoder().encode(message), signature, publicKey.toBytes());
}

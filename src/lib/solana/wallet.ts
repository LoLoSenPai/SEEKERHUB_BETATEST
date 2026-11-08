import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

export function buildWalletChallengeMessage(input: {
  address: string;
  nonce: string;
  appUrl: string;
  purpose: "LINK" | "VERIFY_SGT" | "SIGN_IN" | "SIGN_IN_AND_VERIFY_SGT";
  expiresAt: Date;
  sgtContext?: string;
}) {
  const url = new URL(input.appUrl);
  const statements = {
    LINK: "Link this wallet to your SeekerHub tester account.",
    VERIFY_SGT: "Verify Seeker Genesis Token ownership for private beta access.",
    SIGN_IN: "Continue to SeekerHub. Recover your tester account or create one with this wallet. No transaction or payment.",
    SIGN_IN_AND_VERIFY_SGT: "Sign in to SeekerHub and authorize a fresh on-chain Seeker Genesis Token ownership check for this wallet for beta access. This does not prove that the current device is a Seeker. No transaction or payment.",
  } as const;

  if (input.purpose === "SIGN_IN_AND_VERIFY_SGT" && !input.sgtContext) {
    throw new Error("Combined wallet sign-in requires a validated SGT context.");
  }

  return [
    `${url.host} wants you to sign in with your Solana account:`,
    input.address,
    "",
    statements[input.purpose],
    ...(input.purpose === "SIGN_IN_AND_VERIFY_SGT" ? [`SGT access context: ${input.sgtContext}`] : []),
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

import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

export function buildWalletChallengeMessage(address: string, nonce: string) {
  return [`SeekerHub wallet link`, `Address: ${address}`, `Nonce: ${nonce}`, `Purpose: link wallet to beta access`].join("\n");
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

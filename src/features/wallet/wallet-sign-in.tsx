"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { Button } from "@/src/components/ui/button";
import { WalletConnectButton } from "@/src/features/wallet/wallet-connect-button";

export function WalletSignIn({ returnTo }: { returnTo: string }) {
  const wallet = useWallet();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <div className="mt-4 grid gap-3 rounded-[1.5rem] border border-border bg-muted/50 p-4">
      <div>
        <div className="text-sm font-semibold">Recover with wallet</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">Use a wallet already linked to a tester account. New wallets must first be linked from an active guest session.</div>
      </div>
      <WalletConnectButton />
      <Button variant="secondary" disabled={!wallet.publicKey || !wallet.signMessage || pending} onClick={async () => {
        if (!wallet.publicKey || !wallet.signMessage) return;
        setPending(true);
        try {
          const address = wallet.publicKey.toBase58();
          const challengeResponse = await fetch("/api/wallet/challenge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ address, purpose: "SIGN_IN" }),
          });
          const challenge = await challengeResponse.json();
          if (!challengeResponse.ok) throw new Error(challenge.error ?? "Unable to create wallet sign-in challenge.");
          const signature = await wallet.signMessage(new TextEncoder().encode(challenge.message));
          const response = await fetch("/api/auth/sign-in/solana-wallet", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ challengeId: challenge.challengeId, address, signature: bs58.encode(signature) }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Wallet sign-in failed.");
          toast.success("Tester access recovered.");
          router.push(returnTo);
          router.refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Wallet sign-in failed.");
        } finally {
          setPending(false);
        }
      }}>{pending ? "Signing message..." : "Sign in with connected wallet"}</Button>
    </div>
  );
}

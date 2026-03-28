"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { WalletConnectButton } from "@/src/features/wallet/wallet-connect-button";

type LinkedWalletSummary = {
  id: string;
  address: string;
  verifiedAt: Date;
  isPrimary: boolean;
  seekerGenesisVerifiedAt: Date | null;
};

export function WalletLinkCard({ linkedWallets }: { linkedWallets: LinkedWalletSummary[] }) {
  const router = useRouter();
  const wallet = useWallet();
  const [linking, setLinking] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const connectedWalletAddress = wallet.publicKey?.toBase58();
  const connectedLinkedWallet = connectedWalletAddress
    ? linkedWallets.find((linkedWallet) => linkedWallet.address === connectedWalletAddress)
    : null;

  return (
    <Card className="rounded-[1.6rem]">
      <CardHeader>
        <CardTitle>Wallet and Seeker access</CardTitle>
        <CardDescription>
          Link a Solana wallet when a release needs wallet gating, allowlists, or optional verified Seeker ownership.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <WalletConnectButton />
        <div className="text-sm text-muted-foreground">
          {connectedWalletAddress ? `Connected wallet: ${connectedWalletAddress}` : "No wallet connected yet."}
        </div>
        <div className="rounded-[1.2rem] border border-border bg-muted/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Linked wallets</div>
          {linkedWallets.length ? (
            <div className="mt-3 grid gap-3">
              {linkedWallets.map((linkedWallet) => (
                <div key={linkedWallet.id} className="rounded-[1rem] border border-border/80 bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={linkedWallet.isPrimary ? "brand" : "neutral"}>
                      {linkedWallet.isPrimary ? "Primary wallet" : "Linked wallet"}
                    </Badge>
                    <Badge variant={linkedWallet.seekerGenesisVerifiedAt ? "success" : "neutral"}>
                      {linkedWallet.seekerGenesisVerifiedAt ? "Seeker verified" : "Standard wallet"}
                    </Badge>
                    {connectedWalletAddress === linkedWallet.address ? <Badge>Currently connected</Badge> : null}
                  </div>
                  <div className="mt-2 break-all font-mono text-xs text-foreground">{linkedWallet.address}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">No linked wallets yet. Connect one, sign the challenge, then verify Seeker ownership if needed.</div>
          )}
        </div>
        {connectedLinkedWallet ? (
          <div className="rounded-[1.2rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {connectedLinkedWallet.seekerGenesisVerifiedAt
              ? "This connected wallet is already linked and verified as a Seeker wallet."
              : "This connected wallet is already linked. Run Seeker verification if a release requires it."}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={!wallet.publicKey || !wallet.signMessage || linking || Boolean(connectedLinkedWallet)}
            onClick={async () => {
              if (!wallet.publicKey || !wallet.signMessage) return;
              setLinking(true);

              try {
                const challengeResponse = await fetch("/api/wallet/challenge", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ address: wallet.publicKey.toBase58() }),
                });
                const challengePayload = await challengeResponse.json();

                if (!challengeResponse.ok) {
                  throw new Error(challengePayload.error ?? "Unable to create a wallet challenge.");
                }

                const signature = await wallet.signMessage(new TextEncoder().encode(challengePayload.message));
                const linkResponse = await fetch("/api/wallet/link", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    challengeId: challengePayload.challengeId,
                    address: wallet.publicKey.toBase58(),
                    signature: bs58.encode(signature),
                  }),
                });
                const linkPayload = await linkResponse.json();

                if (!linkResponse.ok) {
                  throw new Error(linkPayload.error ?? "Unable to link wallet.");
                }

                toast.success("Wallet linked.");
                router.refresh();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Wallet linking failed.");
              } finally {
                setLinking(false);
              }
            }}
          >
            {linking ? "Linking..." : connectedLinkedWallet ? "Wallet already linked" : "Link connected wallet"}
          </Button>
          <Button
            variant="secondary"
            disabled={!wallet.publicKey || verifying || Boolean(connectedLinkedWallet?.seekerGenesisVerifiedAt)}
            onClick={async () => {
              setVerifying(true);
              try {
                const response = await fetch("/api/wallet/verify-seeker", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ address: wallet.publicKey?.toBase58() }),
                });
                const payload = await response.json();

                if (!response.ok) {
                  throw new Error(payload.error ?? "Unable to verify Seeker ownership.");
                }

                toast.success(payload.verified ? "Seeker wallet verified." : "No Seeker Genesis token found.");
                router.refresh();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Seeker verification failed.");
              } finally {
                setVerifying(false);
              }
            }}
          >
            {verifying
              ? "Checking..."
              : connectedLinkedWallet?.seekerGenesisVerifiedAt
                ? "Seeker already verified"
                : "Verify Seeker wallet"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

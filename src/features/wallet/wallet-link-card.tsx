"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { ContinueWithWallet } from "./continue-with-wallet";
import { useWalletAction } from "./use-wallet-action";
import { WalletName } from "./wallet-name";
import type { WalletSgtContext } from "./wallet-request";

type LinkedWalletSummary = {
  id: string;
  address: string;
  isPrimary: boolean;
  seekerGenesisVerificationExpiresAt: Date | null;
};

export function WalletLinkCard({ linkedWallets, requiredSeeker = false, showSeeker = true, sgtContext }: {
  linkedWallets: LinkedWalletSummary[];
  requiredSeeker?: boolean;
  showSeeker?: boolean;
  sgtContext?: WalletSgtContext;
}) {
  const wallet = useWallet();
  const action = useWalletAction();
  const address = wallet.publicKey?.toBase58();
  const connectedLinkedWallet = linkedWallets.find((linked) => linked.address === address);
  const isVerified = (linked: LinkedWalletSummary) => Boolean(
    linked.seekerGenesisVerificationExpiresAt && new Date(linked.seekerGenesisVerificationExpiresAt) > new Date(),
  );
  const connectedSeekerVerified = Boolean(connectedLinkedWallet && isVerified(connectedLinkedWallet));

  return (
    <Card className="min-w-0 overflow-hidden rounded-[1.6rem]">
      <CardHeader>
        <CardTitle>Wallet access</CardTitle>
        <CardDescription>
          {connectedLinkedWallet
            ? requiredSeeker && !connectedSeekerVerified ? "Your wallet is linked. Verify Seeker Genesis Token ownership below to continue." : "Your connected wallet is linked to your tester account."
            : "Connect and continue with your wallet to keep or recover tester access. Signing is not a payment."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ContinueWithWallet action={action} accountWalletConnected={Boolean(connectedLinkedWallet)} sgtContext={sgtContext} />
        <div className="rounded-[1.2rem] border border-border bg-muted/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Account wallets</div>
          {linkedWallets.length ? <div className="mt-3 grid gap-3">
            {linkedWallets.map((linked) => <div key={linked.id} className="rounded-[1rem] border border-border/80 bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={linked.isPrimary ? "brand" : "neutral"}>{linked.isPrimary ? "Primary wallet" : "Linked wallet"}</Badge>
                {showSeeker ? <Badge variant={isVerified(linked) ? "success" : "neutral"}>
                  {isVerified(linked) ? "SGT verified (24h)" : "SGT not verified"}
                </Badge> : null}
                {address === linked.address ? <Badge>Currently connected</Badge> : null}
              </div>
              <div className="mt-2 break-all text-sm text-foreground"><WalletName address={linked.address} /></div>
              <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{linked.address}</div>
            </div>)}
          </div> : <p className="mt-3 text-sm text-muted-foreground">No wallet saved yet. Continue above to create or recover wallet access.</p>}
        </div>
        {showSeeker ? <div className="grid gap-3">
          <p className="text-xs leading-5 text-muted-foreground">{sgtContext ? "Wallet sign-in can include a fresh SGT check with one explicit signature. For a linked wallet, use the check below." : "SGT ownership is checked separately and is valid for 24 hours."} A successful check is cached for 24 hours. It does not prove device hardware trust.</p>
          <Button type="button" variant={requiredSeeker ? "primary" : "secondary"}
            disabled={action.pending || !wallet.connected || !wallet.signMessage || !connectedLinkedWallet || connectedSeekerVerified}
            onClick={() => void action.run("VERIFY_SGT")}>
            {action.operation === "VERIFY_SGT" ? "Checking SGT ownership..." : connectedSeekerVerified ? "SGT already verified (24h)" : "Verify Seeker Genesis Token"}
          </Button>
          {!connectedLinkedWallet ? <p className="text-xs text-muted-foreground">{sgtContext ? "Continue above to authorize wallet sign-in and the SGT check together." : "Continue with wallet first, then verify SGT ownership."}</p> : null}
        </div> : null}
      </CardContent>
    </Card>
  );
}

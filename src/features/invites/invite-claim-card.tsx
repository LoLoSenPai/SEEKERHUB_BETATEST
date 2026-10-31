"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { authClient } from "@/src/lib/auth-client";
import { useDeviceContext } from "@/src/features/seeker/use-device-context";
import { ContinueWithWallet } from "@/src/features/wallet/continue-with-wallet";
import { useWalletAction } from "@/src/features/wallet/use-wallet-action";
import { safeReturnTo } from "@/src/lib/redirect";

class InviteSessionExpiredError extends Error {}

export function InviteClaimCard({
  token,
  projectName,
  releaseVersion,
  walletRequired = false,
  walletRecommended = false,
  seekerRequired = false,
  seekerRecommended = false,
  currentIdentity = null,
}: {
  token: string;
  projectName: string;
  releaseVersion?: string | null;
  walletRequired?: boolean;
  walletRecommended?: boolean;
  seekerRequired?: boolean;
  seekerRecommended?: boolean;
  currentIdentity?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [navigating, startTransition] = useTransition();
  const [walletChosen, setWalletChosen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guestLocked = useRef(false);
  const walletAction = useWalletAction();
  const { persistDeviceProfile } = useDeviceContext();

  async function claim() {
    await persistDeviceProfile();
    const response = await fetch(`/api/invites/${encodeURIComponent(token)}/claim`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (response.status === 401) throw new InviteSessionExpiredError("Your session expired. Sign in again to open this beta.");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to claim invite.");
    return safeReturnTo(payload.redirectTo, "/tester");
  }

  return (
    <Card className="rounded-[2rem] border-border bg-surface shadow-[0_24px_90px_rgba(15,23,42,0.08)]">
      <CardHeader>
        <div className="section-eyebrow">Private Android beta</div>
        <CardTitle className="break-words text-2xl">{projectName}</CardTitle>
        <CardDescription>
          {releaseVersion ? `Version ${releaseVersion}. ` : ""}
          {currentIdentity ? "Open with your current tester account. Any wallet or SGT requirements are checked before download." : walletRequired ? "Wallet access is required for this beta. Create or recover your tester access before opening it." : "Use a wallet to keep or recover your tester access, or start as a guest in this browser."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentIdentity ? <p className="break-words text-sm text-muted-foreground">Signed in as <span className="font-semibold text-foreground">{currentIdentity}</span></p> : null}
        {currentIdentity || !walletRequired ? <Button
          size="lg"
          variant={currentIdentity ? "primary" : "secondary"}
          disabled={loading || navigating || walletAction.pending || (!currentIdentity && walletChosen)}
          onClick={async () => {
            if (guestLocked.current || walletAction.pending || (!currentIdentity && walletChosen)) return;
            guestLocked.current = true;
            setLoading(true);
            setError(null);
            try {
              // A previously durable session must never fall back to guest creation.
              if (!currentIdentity) {
                const session = await authClient.getSession();
                if (!session.data) {
                  const guestResult = await authClient.signIn.anonymous();
                  if (guestResult.error) throw new Error(guestResult.error.message);
                }
              }
              const destination = await claim();
              startTransition(() => {
                router.push(destination);
                router.refresh();
                setLoading(false);
              });
            } catch (error) {
              setError(error instanceof Error ? error.message : "Invite claim failed. Please try again.");
              guestLocked.current = false;
              if (error instanceof InviteSessionExpiredError) {
                startTransition(() => {
                  router.refresh();
                  setLoading(false);
                });
              } else {
                setLoading(false);
              }
            }
          }}
        >
          {loading || navigating ? "Opening beta access..." : currentIdentity ? "Open beta access" : "Open beta access as guest"}
        </Button> : null}
        {walletRecommended || seekerRecommended ? <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm leading-6">
          {walletRequired ? "A wallet is required." : currentIdentity ? "Some builds require a wallet. Your current account requirements will be checked before download." : "Some builds require a wallet. Using one now is recommended; guest access remains available for standard builds."}
          {seekerRequired ? " Seeker Genesis Token verification is also required before download." : seekerRecommended ? " Some builds also require Seeker Genesis Token verification." : ""}
          {seekerRecommended ? " If needed, SGT verification is a separate signature after sign-in, valid for 24 hours. It does not prove hardware trust." : ""}
        </div> : null}
        <ContinueWithWallet action={walletAction} disabled={loading || navigating}
          onChoose={() => { setWalletChosen(true); setError(null); }} onAuthenticated={claim} />
        {!currentIdentity && !walletRequired && walletChosen ? <Button type="button" variant="ghost" disabled={walletAction.pending || loading || navigating}
          onClick={() => setWalletChosen(false)}>Choose guest access instead</Button> : null}
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <p className="text-xs leading-5 text-muted-foreground">
          Reopening this link with the same tester account does not use another tester place. {currentIdentity ? "Your current tester account will be used." : walletRequired ? "Use the same wallet to recover access on another browser." : "Guest access remains tied to this browser until you add a recovery email or wallet."}
        </p>
      </CardContent>
    </Card>
  );
}

"use client";

import { ContinueWithWallet } from "./continue-with-wallet";
import { useWalletAction } from "./use-wallet-action";
import type { WalletSgtContext } from "./wallet-request";

export function WalletSignIn({ returnTo = "/tester", sgtContext }: { returnTo?: string; sgtContext?: WalletSgtContext }) {
  const action = useWalletAction();
  return (
    <div className="mt-4 grid gap-3 rounded-[1.5rem] border border-border bg-muted/50 p-4">
      <div>
        <div className="text-sm font-semibold">Continue with wallet</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">New wallet? Create tester access. Returning tester? Recover your apps and feedback with the same wallet.</div>
      </div>
      <ContinueWithWallet action={action} sgtContext={sgtContext} onAuthenticated={() => returnTo} />
    </div>
  );
}

"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/src/components/ui/button";
import { WalletConnectButton } from "./wallet-connect-button";
import type { WalletAction } from "./use-wallet-action";
import { SeekerConnectButton } from "./seeker-connect-button";
import { WalletName } from "./wallet-name";

export function ContinueWithWallet({ action, disabled = false, showSeekerConnect = false, onChoose, onAuthenticated }: {
  action: WalletAction;
  disabled?: boolean;
  showSeekerConnect?: boolean;
  onChoose?: () => void;
  onAuthenticated?: () => Promise<string | void> | string | void;
}) {
  const wallet = useWallet();
  return (
    <div className="grid min-w-0 gap-3" aria-busy={action.pending}>
      {showSeekerConnect ? <SeekerConnectButton disabled={disabled || action.pending} onChoose={onChoose} /> : null}
      <WalletConnectButton disabled={disabled || action.pending} secondary={showSeekerConnect} onChoose={onChoose} />
      {wallet.connected && wallet.publicKey ? <>
        <p className="break-all text-xs text-muted-foreground"><WalletName address={wallet.publicKey.toBase58()} /></p>
        <Button type="button" disabled={disabled || action.pending || !wallet.signMessage}
          onClick={() => { onChoose?.(); void action.run("SIGN_IN", onAuthenticated); }}>
          {action.pending ? action.refreshing ? "Updating access..." : "Completing wallet access..." : "Continue with wallet"}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          {wallet.signMessage ? "Sign a message to create or recover your tester access. This is not a payment." : "This wallet does not support message signing. Select a compatible wallet."}
        </p>
      </> : <p className="text-xs leading-5 text-muted-foreground">Choose a wallet first, then press Continue with wallet to sign. Connecting alone does not sign you in.</p>}
      {action.error ? <p role="alert" className="text-sm text-danger">{action.error}</p> : null}
    </div>
  );
}

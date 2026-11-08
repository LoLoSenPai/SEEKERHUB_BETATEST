"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/src/components/ui/button";
import { WalletConnectButton } from "./wallet-connect-button";
import type { WalletAction } from "./use-wallet-action";
import { WalletName } from "./wallet-name";
import type { WalletSgtContext, WalletSgtOutcome } from "./wallet-request";

export function ContinueWithWallet({ action, disabled = false, accountWalletConnected = false, onChoose, onAuthenticated, sgtContext }: {
  action: WalletAction;
  disabled?: boolean;
  accountWalletConnected?: boolean;
  onChoose?: () => void;
  onAuthenticated?: (sgt?: WalletSgtOutcome) => Promise<string | void> | string | void;
  sgtContext?: WalletSgtContext;
}) {
  const wallet = useWallet();
  return (
    <div className="grid min-w-0 gap-3" aria-busy={action.pending}>
      {wallet.connected && wallet.publicKey ? <>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-all text-sm"><span className="block text-xs text-muted-foreground">Connected wallet</span><WalletName address={wallet.publicKey.toBase58()} /></p>
          <WalletConnectButton disabled={disabled || action.pending} />
        </div>
        {!accountWalletConnected ? <Button type="button" disabled={disabled || action.pending || !wallet.signMessage}
          onClick={() => { onChoose?.(); void (sgtContext
            ? action.run("SIGN_IN_AND_VERIFY_SGT", onAuthenticated, sgtContext)
            : action.run("SIGN_IN", onAuthenticated)); }}>
          {action.pending ? action.refreshing ? "Updating access..." : "Completing wallet access..." : sgtContext ? "Continue with wallet + check SGT" : "Continue with wallet"}
        </Button> : null}
        <p className="text-xs leading-5 text-muted-foreground">
          {!wallet.signMessage ? "This wallet does not support message signing. Disconnect and select a compatible wallet." : accountWalletConnected ? "This wallet is linked to your tester account." : sgtContext ? "One signature authorizes both tester sign-in and a fresh on-chain SGT ownership check for this beta. No payment. This does not prove your current device is a Seeker." : "Sign a message to create or recover your tester access. This is not a payment."}
        </p>
      </> : <>
        <WalletConnectButton disabled={disabled || action.pending} onChoose={onChoose} />
        <p className="text-xs leading-5 text-muted-foreground">{sgtContext ? "Connect your wallet, then sign once to authorize tester sign-in and a fresh SGT ownership check. No payment is requested." : "Connect your wallet, then confirm your tester access with a signature. No payment is requested."}</p>
        <p className="text-xs leading-5 text-muted-foreground">On Android, your default compatible wallet may open directly. Choose the account inside your wallet.</p>
      </>}
      {action.error ? <p role="alert" className="text-sm text-danger">{action.error}</p> : null}
    </div>
  );
}

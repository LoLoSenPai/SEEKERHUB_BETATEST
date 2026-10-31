"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/src/components/ui/button";
import { WalletConnectButton } from "./wallet-connect-button";
import type { WalletAction } from "./use-wallet-action";
import { WalletName } from "./wallet-name";

export function ContinueWithWallet({ action, disabled = false, accountWalletConnected = false, onChoose, onAuthenticated }: {
  action: WalletAction;
  disabled?: boolean;
  accountWalletConnected?: boolean;
  onChoose?: () => void;
  onAuthenticated?: () => Promise<string | void> | string | void;
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
          onClick={() => { onChoose?.(); void action.run("SIGN_IN", onAuthenticated); }}>
          {action.pending ? action.refreshing ? "Updating access..." : "Completing wallet access..." : "Continue with wallet"}
        </Button> : null}
        <p className="text-xs leading-5 text-muted-foreground">
          {!wallet.signMessage ? "This wallet does not support message signing. Disconnect and select a compatible wallet." : accountWalletConnected ? "This wallet is linked to your tester account." : "Sign a message to create or recover your tester access. This is not a payment."}
        </p>
      </> : <>
        <WalletConnectButton disabled={disabled || action.pending} onChoose={onChoose} />
        <p className="text-xs leading-5 text-muted-foreground">Connect your wallet, then confirm your tester access with a signature. No payment is requested.</p>
        <p className="text-xs leading-5 text-muted-foreground">On Android, your default compatible wallet may open directly. Choose the account inside your wallet.</p>
      </>}
      {action.error ? <p role="alert" className="text-sm text-danger">{action.error}</p> : null}
    </div>
  );
}

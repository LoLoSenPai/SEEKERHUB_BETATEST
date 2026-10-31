"use client";

import { Loader2, LogOut, WalletCards } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { WalletName as AdapterWalletName } from "@solana/wallet-adapter-base";
import { SolanaMobileWalletAdapterWalletName } from "@solana-mobile/wallet-standard-mobile";
import { toast } from "sonner";
import { Button } from "@/src/components/ui/button";
import { getWalletErrorCode, getWalletErrorMessage } from "./wallet-error";

export function WalletConnectButton({ disabled = false, onChoose }: { disabled?: boolean; onChoose?: () => void }) {
  const { connected, connecting, disconnecting, wallet, wallets, connect, disconnect, select } = useWallet();
  const { setVisible } = useWalletModal();
  const mobileWallet = wallets.find(({ adapter }) => adapter.name === SolanaMobileWalletAdapterWalletName);
  const pending = connecting || disconnecting;

  return (
    <Button
      type="button"
      variant={connected ? "ghost" : "primary"}
      disabled={disabled || pending}
      onClick={async () => {
        try {
          if (connected) {
            await disconnect();
            return;
          }

          onChoose?.();

          if (wallet?.adapter.name === SolanaMobileWalletAdapterWalletName) {
            await connect();
            return;
          }

          const isAndroidChrome =
            /Android/i.test(navigator.userAgent) &&
            /Chrome\/\d+/i.test(navigator.userAgent) &&
            !/EdgA|OPR|SamsungBrowser/i.test(navigator.userAgent);
          if (isAndroidChrome && mobileWallet) {
            setVisible(false);
            select(SolanaMobileWalletAdapterWalletName as AdapterWalletName);
            return;
          }

          setVisible(true);
        } catch (error) {
          if (getWalletErrorCode(error)) return;
          const message = getWalletErrorMessage(error, "Wallet connection failed.");
          if (message) toast.error(message);
        }
      }}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : connected ? (
        <LogOut className="size-4" aria-hidden="true" />
      ) : (
        <WalletCards className="size-4" aria-hidden="true" />
      )}
      {disconnecting ? "Disconnecting wallet..." : connecting ? "Connecting wallet..." : connected ? "Disconnect wallet" : "Connect wallet"}
    </Button>
  );
}

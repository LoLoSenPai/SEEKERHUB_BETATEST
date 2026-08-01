"use client";

import { Loader2, LogOut, WalletCards } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { WalletName } from "@solana/wallet-adapter-base";
import { SolanaMobileWalletAdapterWalletName } from "@solana-mobile/wallet-standard-mobile";
import { toast } from "sonner";
import { Button } from "@/src/components/ui/button";

export function WalletConnectButton() {
  const { connected, connecting, disconnecting, publicKey, wallet, wallets, connect, disconnect, select } = useWallet();
  const { setVisible } = useWalletModal();
  const mobileWallet = wallets.find(({ adapter }) => adapter.name === SolanaMobileWalletAdapterWalletName);
  const pending = connecting || disconnecting;
  const shortAddress = publicKey ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}` : null;

  return (
    <Button
      type="button"
      variant={connected ? "secondary" : "primary"}
      disabled={pending}
      onClick={async () => {
        try {
          if (connected) {
            await disconnect();
            return;
          }

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
            select(SolanaMobileWalletAdapterWalletName as WalletName);
            return;
          }

          setVisible(true);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Wallet connection failed.");
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
      {pending ? "Connecting wallet..." : connected ? `${shortAddress} · Disconnect` : mobileWallet ? "Use installed wallet" : "Connect wallet"}
    </Button>
  );
}

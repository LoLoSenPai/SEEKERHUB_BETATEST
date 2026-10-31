"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { SeekerConnectWalletName } from "@solana-mobile/seeker-connect-wallet-standard";
import { toast } from "sonner";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
  registerMwa,
} from "@solana-mobile/wallet-standard-mobile";
import { getClientEnv } from "@/src/lib/env";
import { registerSeekerWallet } from "./seeker-wallet-registration";
import { getWalletErrorCode, getWalletErrorMessage } from "./wallet-error";

let mobileWalletRegistered = false;

function registerMobileWallet(appOrigin: string) {
  if (mobileWalletRegistered || typeof window === "undefined") return;

  registerMwa({
    appIdentity: {
      name: "SeekerHub",
      uri: appOrigin,
      icon: "/favicon.ico",
    },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: ["solana:mainnet"],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  });
  mobileWalletRegistered = true;
}

const configuredWalletAdapters: Adapter[] = [];

if (typeof window !== "undefined") {
  registerMobileWallet(window.location.origin);
  registerSeekerWallet(getClientEnv().NEXT_PUBLIC_SEEKER_RELAY_DOMAIN);
}

function handleWalletError(error: WalletError, adapter?: Adapter) {
  const code = getWalletErrorCode(error);
  if (code === "cancelled") return;
  if (adapter?.name === SeekerConnectWalletName) {
    if ((!code || code === "session-closed") && error.name === "WalletConnectionError") {
      const message = getWalletErrorMessage(error);
      if (message) toast.error(message);
    }
    // Other SDK outcomes have branded dialogs; signing errors stay inline.
    return;
  }
  console.error(error, adapter);
}

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const env = getClientEnv();

  return (
    <ConnectionProvider endpoint={env.NEXT_PUBLIC_SOLANA_RPC_URL}>
      <WalletProvider wallets={configuredWalletAdapters} autoConnect onError={handleWalletError}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

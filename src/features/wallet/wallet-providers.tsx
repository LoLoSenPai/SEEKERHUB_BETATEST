"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
  registerMwa,
} from "@solana-mobile/wallet-standard-mobile";
import { getClientEnv } from "@/src/lib/env";

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
}

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const env = getClientEnv();

  return (
    <ConnectionProvider endpoint={env.NEXT_PUBLIC_SOLANA_RPC_URL}>
      <WalletProvider wallets={configuredWalletAdapters} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

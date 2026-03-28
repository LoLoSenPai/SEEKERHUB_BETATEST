"use client";

import { useMemo } from "react";
import { Toaster } from "sonner";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
  SolanaMobileWalletAdapter,
} from "@solana-mobile/wallet-adapter-mobile";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { getClientEnv } from "@/src/lib/env";
import { ThemeProvider } from "@/src/components/theme/theme-provider";
import { ThemeToggle } from "@/src/components/theme/theme-toggle";

import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  const env = getClientEnv();
  const endpoint = env.NEXT_PUBLIC_SOLANA_RPC_URL;
  const appOrigin = typeof window === "undefined" ? env.NEXT_PUBLIC_APP_URL : window.location.origin;

  const wallets = useMemo(
    () => [
      new SolanaMobileWalletAdapter({
        addressSelector: createDefaultAddressSelector(),
        appIdentity: {
          name: "SeekerHub",
          uri: appOrigin,
          icon: `${appOrigin}/globe.svg`,
        },
        authorizationResultCache: createDefaultAuthorizationResultCache(),
        cluster: WalletAdapterNetwork.Mainnet,
        onWalletNotFound: createDefaultWalletNotFoundHandler(),
      }),
    ],
    [appOrigin],
  );

  return (
    <ThemeProvider>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            {children}
            <ThemeToggle />
            <Toaster richColors position="top-right" />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </ThemeProvider>
  );
}

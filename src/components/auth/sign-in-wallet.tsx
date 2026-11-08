"use client";

import dynamic from "next/dynamic";

const WalletSection = dynamic(() => import("./sign-in-wallet-section"), {
  ssr: false,
  loading: () => <p role="status" className="mt-4 p-4 text-sm text-muted-foreground">Loading wallet sign in...</p>,
});

export function SignInWallet({ returnTo }: { returnTo: string }) {
  return <WalletSection returnTo={returnTo} />;
}

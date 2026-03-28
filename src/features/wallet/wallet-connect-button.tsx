"use client";

import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  {
    ssr: false,
    loading: () => (
      <button
        type="button"
        disabled
        className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground opacity-80"
      >
        Connect wallet
      </button>
    ),
  },
);

export function WalletConnectButton() {
  return (
    <WalletMultiButton className="!h-11 !rounded-full !bg-primary !px-5 !text-sm !font-semibold !text-primary-foreground" />
  );
}

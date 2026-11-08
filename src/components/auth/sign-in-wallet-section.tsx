"use client";

import { WalletProviders } from "@/src/features/wallet/wallet-providers";
import { WalletSignIn } from "@/src/features/wallet/wallet-sign-in";

export default function SignInWalletSection({ returnTo }: { returnTo: string }) {
  return <WalletProviders><WalletSignIn returnTo={returnTo} /></WalletProviders>;
}

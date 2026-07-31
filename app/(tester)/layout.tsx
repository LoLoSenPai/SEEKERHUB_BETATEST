import { WalletProviders } from "@/src/features/wallet/wallet-providers";

export default function TesterLayout({ children }: { children: React.ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}

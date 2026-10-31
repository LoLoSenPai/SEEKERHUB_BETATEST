"use client";

import { useWalletName } from "./use-wallet-name";

export function WalletName({ address, className, showAddress = true }: {
  address: string; className?: string; showAddress?: boolean;
}) {
  const { domain, shortAddress } = useWalletName(address);
  return <span className={className} title={address}>
    {domain ? <><span>{domain}</span>{showAddress ? <span className="ml-1.5 font-mono text-[0.85em] opacity-70">({shortAddress})</span> : null}</> : shortAddress}
  </span>;
}

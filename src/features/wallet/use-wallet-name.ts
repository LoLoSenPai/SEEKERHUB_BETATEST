"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/src/lib/auth-client";
import { walletNameLookup } from "./wallet-name-lookup";

export function shortWalletAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

export function useWalletName(address: string) {
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.isAnonymous ? undefined : session?.user.id;
  const key = userId ? `${userId}:${address}` : null;
  const [resolved, setResolved] = useState<{ key: string; domain: string | null } | null>(null);

  useEffect(() => {
    if (!userId || isPending) return;
    return walletNameLookup.subscribe(userId, address, (domain) => {
      setResolved({ key: `${userId}:${address}`, domain });
    });
  }, [address, userId, isPending]);

  const domain = !isPending && resolved?.key === key ? resolved.domain : null;
  const shortAddress = shortWalletAddress(address);
  return { domain, shortAddress, label: domain ?? shortAddress };
}

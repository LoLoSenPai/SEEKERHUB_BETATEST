"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { safeReturnTo } from "@/src/lib/redirect";
import { authClient } from "@/src/lib/auth-client";
import { requestWalletAction, type WalletPurpose } from "./wallet-request";
import { getWalletErrorMessage } from "./wallet-error";

export function useWalletAction() {
  const wallet = useWallet();
  const router = useRouter();
  const locked = useRef(false);
  const [operation, setOperation] = useState<WalletPurpose | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const pending = operation !== null || refreshing;

  useEffect(() => {
    if (!pending) locked.current = false;
  }, [pending]);

  async function run(purpose: WalletPurpose, onSuccess?: () => Promise<string | void> | string | void) {
    if (locked.current || pending) return;
    if (!wallet.connected || !wallet.publicKey || !wallet.signMessage) return;
    locked.current = true;
    setOperation(purpose);
    setError(null);
    let authenticated = false;
    try {
      const adapter = wallet.wallet?.adapter;
      await requestWalletAction({
        purpose,
        address: wallet.publicKey.toBase58(),
        signMessage: wallet.signMessage,
        getAddress: () => adapter?.publicKey?.toBase58(),
      });
      authenticated = purpose === "SIGN_IN";
      if (authenticated) authClient.$store.notify("$sessionSignal");
      // The response (and its Set-Cookie) completes before invitation callbacks run.
      const destination = await onSuccess?.();
      toast.success(purpose === "SIGN_IN" ? "Wallet access ready." : "Seeker Genesis Token verified for 24 hours.");
      startTransition(() => {
        if (destination) router.push(safeReturnTo(destination, "/tester"));
        router.refresh();
        setOperation(null);
      });
    } catch (cause) {
      setError(getWalletErrorMessage(cause));
      if (authenticated) {
        // Authentication may succeed even when the following claim fails.
        startTransition(() => {
          router.refresh();
          setOperation(null);
        });
      } else {
        locked.current = false;
        setOperation(null);
      }
    }
  }

  return { run, pending, refreshing, operation, error };
}

export type WalletAction = ReturnType<typeof useWalletAction>;

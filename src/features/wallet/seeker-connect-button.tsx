"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { WalletName } from "@solana/wallet-adapter-base";
import { SeekerConnectWalletName } from "@solana-mobile/seeker-connect-wallet-standard";
import { toast } from "sonner";
import { Button } from "@/src/components/ui/button";
import { getWalletErrorCode, getWalletErrorMessage } from "./wallet-error";

const subscribe = () => () => {};
const isAndroid = () => /Android/i.test(navigator.userAgent);

export function SeekerConnectButton({ disabled = false, onChoose }: { disabled?: boolean; onChoose?: () => void }) {
  const { wallets, wallet, connected, connecting, disconnecting, select, connect, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [switching, setSwitching] = useState(false);
  const android = useSyncExternalStore(subscribe, isAndroid, () => false);
  const available = wallets.some(({ adapter }) => adapter.name === SeekerConnectWalletName);
  const selected = wallet?.adapter.name === SeekerConnectWalletName;
  useEffect(() => {
    if (!switching || wallet || disconnecting) return;
    // Wait for the provider to retire the old adapter. Selecting from its stale
    // closure would disconnect it again and clear the new selection asynchronously.
    select(SeekerConnectWalletName as WalletName);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Acknowledge one explicit user-requested adapter handoff, not derived render state.
    setSwitching(false);
  }, [switching, wallet, disconnecting, select]);
  if (!android || !available) return null;
  return (
    <div className="grid gap-2">
      <Button type="button" disabled={disabled || switching || connecting || disconnecting || (selected && connected)}
        onClick={async () => {
          onChoose?.();
          setVisible(false);
          try {
            if (selected) await connect();
            else if (wallet) {
              setSwitching(true);
              await disconnect();
            } else select(SeekerConnectWalletName as WalletName);
          } catch (error) {
            setSwitching(false);
            // SDK outcomes already have branded feedback; cancellation stays silent.
            if (getWalletErrorCode(error)) return;
            const message = getWalletErrorMessage(error, "Unable to connect. Try again or choose another wallet.");
            if (message) toast.error(message);
          }
        }}>
        {switching || (connecting && selected) ? "Connecting Seeker Connect..." : selected && connected ? "Seeker Connect selected" : "Use Seeker Connect"}
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">Recommended for SGT verification on Seeker. Selecting it does not sign you in or verify token ownership.</p>
    </div>
  );
}

import { registerSeekerConnect } from "@solana-mobile/seeker-connect-wallet-standard";
import { getWalletAppIdentity } from "@/src/lib/brand";

let registered = false;

export function registerSeekerWallet(relayDomain: string, enabled = false) {
  if (!enabled || registered || !relayDomain || typeof window === "undefined" || window.location.protocol !== "https:") return;
  registerSeekerConnect({
    identity: getWalletAppIdentity(window.location.origin),
    relayDomain,
    chain: "solana:mainnet",
    // Leave the first-connect App Link to the official SDK default.
  });
  registered = true;
}

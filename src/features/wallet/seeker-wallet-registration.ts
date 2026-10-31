import { registerSeekerConnect } from "@solana-mobile/seeker-connect-wallet-standard";

let registered = false;

export function registerSeekerWallet(relayDomain: string) {
  if (registered || !relayDomain || typeof window === "undefined" || window.location.protocol !== "https:") return;
  registerSeekerConnect({
    identity: { name: "SeekerHub", uri: window.location.origin, icon: "/favicon.ico" },
    relayDomain,
    chain: "solana:mainnet",
    // Leave the first-connect App Link to the official SDK default.
  });
  registered = true;
}

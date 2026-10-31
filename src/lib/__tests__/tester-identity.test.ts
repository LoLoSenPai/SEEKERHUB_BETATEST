import { describe, expect, it } from "vitest";
import { getTesterIdentityLabel } from "@/src/lib/tester-identity";

describe("tester identity labels", () => {
  const secondary = { address: "1111222233334444", isPrimary: false };
  const primary = { address: "5555666677778888", isPrimary: true };

  it("keeps an anonymous tester labeled as guest even with a wallet", () => {
    expect(getTesterIdentityLabel({ isAnonymous: true, email: "temp@seekerhub.local", wallets: [primary] })).toBe("Guest tester");
  });

  it("displays a real email instead of substituting a linked wallet", () => {
    expect(getTesterIdentityLabel({ isAnonymous: false, email: "tester@example.test", wallets: [primary] })).toBe("tester@example.test");
  });

  it("hides a synthetic wallet-account email and prefers the primary wallet", () => {
    expect(getTesterIdentityLabel({ isAnonymous: false, email: "wallet-random@seekerhub.local", wallets: [secondary, primary] })).toBe("Wallet 5555...8888");
  });

  it("falls back to the first wallet when no primary is marked", () => {
    expect(getTesterIdentityLabel({ email: "wallet-random@seekerhub.local", wallets: [secondary] })).toBe("Wallet 1111...4444");
  });

  it.each([undefined, []])("does not expose an internal email when wallets are absent (%j)", (wallets) => {
    expect(getTesterIdentityLabel({ email: "wallet-random@seekerhub.local", wallets })).toBe("Tester account");
  });
});

import { describe, expect, it } from "vitest";
import { parseEnvBoolean } from "@/src/lib/env";
import { safeReturnTo } from "@/src/lib/redirect";
import { accessPolicyInputSchema, deviceContextInputSchema } from "@/src/lib/validation";

const validAddress = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4";

describe("public beta hardening helpers", () => {
  it("parses false-like environment values without Boolean coercion bugs", () => {
    expect(parseEnvBoolean("false", true)).toBe(false);
    expect(parseEnvBoolean("0", true)).toBe(false);
    expect(parseEnvBoolean("true", false)).toBe(true);
  });

  it("rejects unknown environment booleans", () => {
    expect(() => parseEnvBoolean("sometimes", false)).toThrow("Invalid boolean");
  });

  it("makes a non-empty wallet allowlist require wallet linking", () => {
    const policy = accessPolicyInputSchema.parse({ walletAllowlist: [validAddress] });
    expect(policy.requireLinkedWallet).toBe(true);
  });

  it("rejects malformed Solana allowlist addresses", () => {
    expect(() => accessPolicyInputSchema.parse({ walletAllowlist: ["not-a-wallet"] })).toThrow();
  });

  it("does not accept a client-declared verified SGT recognition source", () => {
    expect(() => deviceContextInputSchema.parse({
      deviceClass: "MOBILE",
      isSeeker: true,
      isSolanaMobileCapable: true,
      hasMobileWalletAdapterContext: true,
      recognitionSource: "VERIFIED_WALLET_SGT",
    })).toThrow();
  });

  it("allows only local return paths", () => {
    expect(safeReturnTo("/tester/releases/abc", "/tester")).toBe("/tester/releases/abc");
    expect(safeReturnTo("//evil.example", "/tester")).toBe("/tester");
    expect(safeReturnTo("https://evil.example", "/tester")).toBe("/tester");
  });
});

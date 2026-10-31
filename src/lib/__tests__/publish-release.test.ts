import { describe, expect, it } from "vitest";
import { publishReleaseInputSchema } from "@/src/features/releases/publish-input";

const wallet = "11111111111111111111111111111111";
const base = { changelog: "Release notes", accessPolicy: {}, invitation: {} };

describe("publish release input", () => {
  it("rejects access without an invite or wallet allowlist, even with a group", () => {
    const result = publishReleaseInputSchema.safeParse({ ...base, accessPolicy: { requireInviteAcceptance: false, testerGroupId: "group" } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["accessPolicy", "walletAllowlist"] })]));
  });

  it("accepts an allowlisted wallet without an invite and requires a linked wallet", () => {
    const result = publishReleaseInputSchema.parse({ ...base, accessPolicy: { requireInviteAcceptance: false, walletAllowlist: [wallet, wallet], testerGroupId: "group" } });
    expect(result.accessPolicy).toMatchObject({ testerGroupId: "group", requireLinkedWallet: true, walletAllowlist: [wallet] });
  });

  it("rejects invalid wallet addresses", () => {
    expect(publishReleaseInputSchema.safeParse({ ...base, accessPolicy: { walletAllowlist: ["not-a-wallet"] } }).success).toBe(false);
  });

  it("accepts structurally valid expiration even in the past so committed publications remain retryable", () => {
    for (const expiresAt of [new Date(Date.now() + 86_400_000).toISOString(), "2000-01-01T00:00:00.000Z", null]) {
      expect(publishReleaseInputSchema.safeParse({ ...base, invitation: { expiresAt } }).success).toBe(true);
    }
  });

  it("still rejects malformed expiration datetimes", () => {
    for (const expiresAt of ["not-a-date", "2026-10-31", "2026-99-99T12:00:00.000Z"]) {
      const result = publishReleaseInputSchema.safeParse({ ...base, invitation: { expiresAt } });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["invitation", "expiresAt"] })]));
    }
  });

  it("defaults to a release-scoped invite and enforces tester limits", () => {
    expect(publishReleaseInputSchema.parse(base).invitation).toEqual({ scope: "release", maxUses: null, expiresAt: null });
    for (const maxUses of [0, 1.5, 10_001]) {
      expect(publishReleaseInputSchema.safeParse({ ...base, invitation: { maxUses } }).success).toBe(false);
    }
  });
});

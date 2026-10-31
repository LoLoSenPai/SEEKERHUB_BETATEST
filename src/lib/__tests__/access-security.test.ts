import { describe, expect, it } from "vitest";
import { evaluateReleaseAccess, isPolicyAudienceBroadened } from "@/src/lib/access";

const now = new Date("2026-10-31T12:00:00Z");
const policy = {
  id: "policy", releaseId: "release", requireInviteAcceptance: false, testerGroupId: null,
  requireLinkedWallet: true, requireVerifiedSeeker: false, requireSolanaMobile: false,
  allowPreviousReleases: false, createdAt: now, updatedAt: now, walletEntries: [{ address: "allowed" }],
};
function evaluate(overrides: Partial<Parameters<typeof evaluateReleaseAccess>[0]> = {}) {
  return evaluateReleaseAccess({ policy, testerMemberships: [], inviteClaims: [], wallets: [],
    deviceProfile: null, releaseId: "release", projectId: "project", now, ...overrides });
}

describe("private audience metadata", () => {
  it.each([{ wallets: [] }, { wallets: [{ address: "other" }] }])("hides no-invite allowlisted metadata for nonmatching wallets %j", ({ wallets }) => {
    const decision = evaluate({ wallets: wallets as never });
    expect(decision.canViewMetadata).toBe(false);
    expect(decision.canDownload).toBe(false);
    expect(decision.canSubmitFeedback).toBe(false);
  });
  it("does not bypass an allowlist with an unrelated invitation entitlement", () => {
    expect(evaluate({ inviteClaims: [{ grantedAt: now, inviteLink: { projectId: "project", releaseId: null } }] }).canViewMetadata).toBe(false);
  });
  it("discovers the release using an exact linked address", () => {
    expect(evaluate({ wallets: [{ address: "allowed" }] as never }).canDownload).toBe(true);
  });
  it("shows all requirements for a pending invite without granting download", () => {
    const decision = evaluate({ policy: { ...policy, requireInviteAcceptance: true, testerGroupId: "group", requireVerifiedSeeker: true },
      inviteClaims: [{ grantedAt: null, inviteLink: { projectId: "project", releaseId: "release" } }] });
    expect(decision.canViewMetadata).toBe(true);
    expect(decision.canDownload).toBe(false);
    expect(decision.reasons.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "INVITE_PENDING_ELIGIBILITY", "GROUP_REQUIRED", "WALLET_NOT_ALLOWLISTED", "SGT_VERIFICATION_REQUIRED",
    ]));
  });
  it("preserves a granted seat after link closure, subject to current policy", () => {
    expect(evaluate({ policy: { ...policy, requireInviteAcceptance: true }, wallets: [{ address: "allowed" }] as never,
      inviteClaims: [{ grantedAt: now, inviteLink: { projectId: "project", releaseId: null, revokedAt: now, expiresAt: now } }],
    }).canDownload).toBe(true);
  });
  it("does not treat a revoked claim or another project's membership as entitlement", () => {
    expect(evaluate({ policy: { ...policy, requireInviteAcceptance: true },
      inviteClaims: [{ grantedAt: now, revokedAt: now, inviteLink: { projectId: "project", releaseId: null } }],
    }).canViewMetadata).toBe(false);
    expect(evaluate({ policy: { ...policy, testerGroupId: "group", walletEntries: [] },
      testerMemberships: [{ testerGroupId: "group", projectId: "other", revokedAt: null }] as never,
    }).canViewMetadata).toBe(false);
  });
});

describe("audience broadening confirmation", () => {
  const before = { requireInviteAcceptance: true, testerGroupId: "group", requireLinkedWallet: true,
    requireVerifiedSeeker: true, allowPreviousReleases: false, walletAllowlist: ["a", "b"] };
  it.each([
    { requireInviteAcceptance: false }, { testerGroupId: null }, { testerGroupId: "other" },
    { requireLinkedWallet: false }, { requireVerifiedSeeker: false }, { allowPreviousReleases: true },
    { walletAllowlist: [] }, { walletAllowlist: ["a", "c"] },
  ])("requires confirmation for %j", (change) => {
    expect(isPolicyAudienceBroadened(before, { ...before, ...change })).toBe(true);
  });
  it("allows unchanged, reordered or more restrictive allowlists without confirmation", () => {
    for (const walletAllowlist of [["a", "b"], ["b", "a"], ["a"]]) {
      expect(isPolicyAudienceBroadened(before, { ...before, walletAllowlist })).toBe(false);
    }
  });
});

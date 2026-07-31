import { describe, expect, it } from "vitest";
import { evaluateReleaseAccess } from "@/src/lib/access";

const basePolicy = {
  id: "policy",
  releaseId: "release",
  requireInviteAcceptance: false,
  testerGroupId: null,
  requireLinkedWallet: false,
  requireSolanaMobile: false,
  requireVerifiedSeeker: false,
  allowPreviousReleases: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  walletEntries: [],
};

function evaluate(overrides: Partial<Parameters<typeof evaluateReleaseAccess>[0]> = {}) {
  return evaluateReleaseAccess({
    policy: basePolicy,
    testerMemberships: [],
    inviteClaims: [],
    wallets: [],
    deviceProfile: null,
    releaseId: "release",
    projectId: "project",
    now: new Date("2026-07-31T12:00:00.000Z"),
    ...overrides,
  });
}

describe("evaluateReleaseAccess", () => {
  it("allows a granted project invite", () => {
    const result = evaluate({
      policy: { ...basePolicy, requireInviteAcceptance: true },
      inviteClaims: [{ grantedAt: new Date(), inviteLink: { projectId: "project", releaseId: null } }],
    });
    expect(result.canViewMetadata).toBe(true);
    expect(result.canDownload).toBe(true);
  });

  it("keeps an already granted claim after its share link is revoked", () => {
    const result = evaluate({
      policy: { ...basePolicy, requireInviteAcceptance: true },
      inviteClaims: [{
        grantedAt: new Date(),
        inviteLink: { projectId: "project", releaseId: null, revokedAt: new Date() },
      }],
    });
    expect(result.canDownload).toBe(true);
  });

  it("blocks every release after project-level tester revocation", () => {
    const result = evaluate({ testerAccessRevoked: true });
    expect(result.canViewMetadata).toBe(false);
    expect(result.canDownload).toBe(false);
    expect(result.reasons[0].code).toBe("TESTER_REVOKED");
  });

  it("lets a granted release invite expose an older build when enabled", () => {
    const result = evaluate({
      policy: { ...basePolicy, requireInviteAcceptance: true },
      releaseId: "older-release",
      releasePublishedAt: new Date("2026-07-01T12:00:00.000Z"),
      inviteClaims: [{
        grantedAt: new Date(),
        inviteLink: {
          projectId: "project",
          releaseId: "newer-release",
          release: {
            publishedAt: new Date("2026-07-31T12:00:00.000Z"),
            accessPolicy: { allowPreviousReleases: true },
          },
        },
      }],
    });
    expect(result.canDownload).toBe(true);
  });

  it("shows metadata but blocks a pending eligible-place claim", () => {
    const result = evaluate({
      policy: { ...basePolicy, requireInviteAcceptance: true },
      inviteClaims: [{ grantedAt: null, inviteLink: { projectId: "project", releaseId: null } }],
    });
    expect(result.canViewMetadata).toBe(true);
    expect(result.canDownload).toBe(false);
    expect(result.reasons[0].code).toBe("INVITE_PENDING_ELIGIBILITY");
  });

  it("blocks a wallet that is not allowlisted", () => {
    const result = evaluate({
      policy: { ...basePolicy, requireLinkedWallet: true, walletEntries: [{ address: "allowed-wallet" }] },
      wallets: [{ address: "other-wallet" } as never],
    });
    expect(result.canViewMetadata).toBe(true);
    expect(result.canDownload).toBe(false);
    expect(result.reasons.some((reason) => reason.code === "WALLET_NOT_ALLOWLISTED")).toBe(true);
  });

  it("treats device capability as advisory", () => {
    const result = evaluate({
      policy: { ...basePolicy, requireSolanaMobile: true },
      deviceProfile: { isSolanaMobileCapable: false } as never,
    });
    expect(result.canDownload).toBe(true);
    expect(result.reasons).toContainEqual(expect.objectContaining({ code: "SOLANA_MOBILE_ADVISORY", blocking: false }));
  });

  it("rejects an expired SGT verification", () => {
    const result = evaluate({
      policy: { ...basePolicy, requireLinkedWallet: true, requireVerifiedSeeker: true },
      wallets: [{ seekerGenesisVerifiedAt: new Date(), seekerGenesisVerificationExpiresAt: new Date("2026-07-31T11:00:00.000Z") } as never],
    });
    expect(result.canDownload).toBe(false);
    expect(result.reasons.some((reason) => reason.code === "SGT_VERIFICATION_EXPIRED")).toBe(true);
  });

  it("accepts a current SGT verification", () => {
    const result = evaluate({
      policy: { ...basePolicy, requireLinkedWallet: true, requireVerifiedSeeker: true },
      wallets: [{ seekerGenesisVerifiedAt: new Date(), seekerGenesisVerificationExpiresAt: new Date("2026-08-01T11:00:00.000Z") } as never],
    });
    expect(result.canDownload).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });
});

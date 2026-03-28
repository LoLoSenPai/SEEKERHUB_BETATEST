import { describe, expect, it } from "vitest";
import { evaluateReleaseAccess } from "@/src/lib/access";

describe("evaluateReleaseAccess", () => {
  it("allows project invite access when no extra constraints apply", () => {
    const result = evaluateReleaseAccess({
      policy: {
        id: "policy",
        releaseId: "release",
        requireInviteAcceptance: true,
        testerGroupId: null,
        requireLinkedWallet: false,
        requireSolanaMobile: false,
        requireVerifiedSeeker: false,
        allowPreviousReleases: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        walletEntries: [],
      },
      testerMemberships: [],
      inviteClaims: [
        {
          inviteLink: {
            projectId: "project",
            releaseId: null,
          },
        },
      ],
      wallets: [],
      deviceProfile: null,
      releaseId: "release",
      projectId: "project",
    });

    expect(result.canDownload).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("blocks access when wallet allowlist does not match", () => {
    const result = evaluateReleaseAccess({
      policy: {
        id: "policy",
        releaseId: "release",
        requireInviteAcceptance: false,
        testerGroupId: null,
        requireLinkedWallet: true,
        requireSolanaMobile: false,
        requireVerifiedSeeker: false,
        allowPreviousReleases: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        walletEntries: [{ address: "allowed-wallet" }],
      },
      testerMemberships: [],
      inviteClaims: [],
      wallets: [{ address: "other-wallet", seekerGenesisVerifiedAt: null } as never],
      deviceProfile: null,
      releaseId: "release",
      projectId: "project",
    });

    expect(result.canView).toBe(false);
    expect(result.reasons[0]).toContain("allowlist");
  });

  it("blocks access when a Solana Mobile capable device is required", () => {
    const result = evaluateReleaseAccess({
      policy: {
        id: "policy",
        releaseId: "release",
        requireInviteAcceptance: false,
        testerGroupId: null,
        requireLinkedWallet: false,
        requireSolanaMobile: true,
        requireVerifiedSeeker: false,
        allowPreviousReleases: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        walletEntries: [],
      },
      testerMemberships: [],
      inviteClaims: [],
      wallets: [],
      deviceProfile: {
        isSolanaMobileCapable: false,
      } as never,
      releaseId: "release",
      projectId: "project",
    });

    expect(result.canDownload).toBe(false);
    expect(result.reasons[0]).toContain("Solana Mobile");
  });

  it("blocks access when a verified Seeker wallet is required", () => {
    const result = evaluateReleaseAccess({
      policy: {
        id: "policy",
        releaseId: "release",
        requireInviteAcceptance: false,
        testerGroupId: null,
        requireLinkedWallet: true,
        requireSolanaMobile: false,
        requireVerifiedSeeker: true,
        allowPreviousReleases: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        walletEntries: [{ address: "allowed-wallet" }],
      },
      testerMemberships: [],
      inviteClaims: [],
      wallets: [{ address: "allowed-wallet", seekerGenesisVerifiedAt: null } as never],
      deviceProfile: null,
      releaseId: "release",
      projectId: "project",
    });

    expect(result.canView).toBe(false);
    expect(result.reasons[0]).toContain("Seeker");
  });

  it("allows access when allowlist and verified Seeker requirements are both satisfied", () => {
    const result = evaluateReleaseAccess({
      policy: {
        id: "policy",
        releaseId: "release",
        requireInviteAcceptance: false,
        testerGroupId: null,
        requireLinkedWallet: true,
        requireSolanaMobile: false,
        requireVerifiedSeeker: true,
        allowPreviousReleases: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        walletEntries: [{ address: "allowed-wallet" }],
      },
      testerMemberships: [],
      inviteClaims: [],
      wallets: [{ address: "allowed-wallet", seekerGenesisVerifiedAt: new Date() } as never],
      deviceProfile: null,
      releaseId: "release",
      projectId: "project",
    });

    expect(result.canView).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });
});

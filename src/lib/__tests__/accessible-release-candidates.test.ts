import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), releases: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: { user: { findUnique: mocks.user }, release: { findMany: mocks.releases } } }));
import { getAccessibleReleasesForUser } from "@/src/features/projects/queries";

const now = new Date("2026-10-31T12:00:00Z");
const identity = () => ({ wallets: [{ address: "allowed" }], testerMemberships: [
  { testerGroupId: "active", revokedAt: null, projectId: "project" },
  { testerGroupId: "revoked", revokedAt: now, projectId: "project" },
], testerAccesses: [{ projectId: "blocked", revokedAt: now }], inviteClaims: [
  { grantedAt: now, revokedAt: null, inviteLink: { projectId: "project", releaseId: "newest",
    release: { publishedAt: now, accessPolicy: { allowPreviousReleases: true } } } },
  { grantedAt: null, revokedAt: null, inviteLink: { projectId: "pending-project", releaseId: "pending" } },
  { grantedAt: now, revokedAt: now, inviteLink: { projectId: "revoked-project", releaseId: null } },
], deviceProfiles: [] });
function release(id: string) {
  return { id, projectId: "project", publishedAt: now, accessPolicy: { requireInviteAcceptance: true,
    testerGroupId: null, requireLinkedWallet: false, requireVerifiedSeeker: false, requireSolanaMobile: false,
    walletEntries: [] } };
}
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue(identity()); mocks.releases.mockResolvedValue([]); });

describe("dashboard candidate query", () => {
  it("queries claims including older builds, active groups and exact allowlisted wallets", async () => {
    await getAccessibleReleasesForUser("user");
    const query = mocks.releases.mock.calls[0][0];
    expect(query.take).toBe(100);
    expect(query.where.projectId).toEqual({ notIn: ["blocked"] });
    expect(query.where.AND[0].OR).toEqual(expect.arrayContaining([
      { projectId: "project", OR: [{ id: "newest" }, { publishedAt: { lte: now } }] },
      { projectId: "pending-project", id: "pending" },
      { accessPolicy: { requireInviteAcceptance: false, AND: [
        { OR: [{ testerGroupId: null }, { testerGroupId: { in: ["active"] } }] },
        { OR: [{ walletEntries: { none: {} } }, { walletEntries: { some: { address: { in: ["allowed"] } } } }] },
      ] } },
    ]));
    expect(JSON.stringify(query)).not.toContain("revoked-project");
  });
  it("continues past the first 100 candidates and retains final policy evaluation", async () => {
    mocks.releases.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => release(`r${i}`)))
      .mockResolvedValueOnce([release("older"), { ...release("hidden"), accessPolicy: null }]);
    const rows = await getAccessibleReleasesForUser("user");
    expect(rows).toHaveLength(101);
    expect(rows.at(-1)?.id).toBe("older");
    expect(mocks.releases).toHaveBeenCalledTimes(2);
    expect(mocks.releases.mock.calls[1][0].where.AND[1]).toEqual({ OR: [
      { publishedAt: { lt: now } }, { publishedAt: now, id: { lt: "r99" } },
    ] });
  });
  it("never queries releases for a missing identity", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await getAccessibleReleasesForUser("missing")).toEqual([]);
    expect(mocks.releases).not.toHaveBeenCalled();
  });
});

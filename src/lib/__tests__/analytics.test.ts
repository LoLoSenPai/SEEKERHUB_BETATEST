import { beforeEach, describe, expect, it, vi } from "vitest";
import { releaseAnalyticsClaimScope, summarizeClaims, summarizeIdentities } from "@/src/lib/analytics";

const mocks = vi.hoisted(() => ({
  projects: vi.fn(), projectCount: vi.fn(), release: vi.fn(), releaseCount: vi.fn(),
  claims: vi.fn(), downloads: vi.fn(), downloadCount: vi.fn(), views: vi.fn(), feedbackCount: vi.fn(),
}));
vi.mock("@/src/lib/db", () => ({ prisma: {
  appProject: { findMany: mocks.projects, count: mocks.projectCount },
  release: { findFirst: mocks.release, count: mocks.releaseCount },
  inviteClaim: { findMany: mocks.claims },
  downloadEvent: { findMany: mocks.downloads, count: mocks.downloadCount },
  releaseViewEvent: { findMany: mocks.views }, feedbackReport: { count: mocks.feedbackCount },
} }));
import { getBuilderDashboard, getReleaseForOwner } from "@/src/features/projects/queries";

const now = new Date("2026-10-31T12:00:00Z");
const account = { isAnonymous: false };
const guest = { isAnonymous: true };
const events = [
  { userId: "wallet", user: account, releaseId: "one" },
  { userId: "wallet", user: account, releaseId: "two" },
  { userId: "guest", user: guest, releaseId: "one" },
  { userId: null, user: null, releaseId: "one" },
];
const claims = [
  { userId: "wallet", grantedAt: now, revokedAt: null },
  { userId: "wallet", grantedAt: now, revokedAt: null },
  { userId: "guest", grantedAt: null, revokedAt: null },
  { userId: "revoked", grantedAt: now, revokedAt: now },
  { userId: "revoked-pending", grantedAt: null, revokedAt: now },
];
const release = { id: "release", projectId: "project", publishedAt: now };

describe("analytics definitions", () => {
  it("deduplicates current user IDs across releases and ignores unidentified events", () => {
    expect(summarizeIdentities(events)).toEqual({ accounts: 1, guests: 1, total: 2 });
    expect(summarizeIdentities([])).toEqual({ accounts: 0, guests: 0, total: 0 });
  });

  it("counts merged guest history only once as a registered / wallet account", () => {
    expect(summarizeIdentities(events.map((event) => event.userId === "guest"
      ? { ...event, userId: "wallet", user: account } : event)))
      .toEqual({ accounts: 1, guests: 0, total: 1 });
  });

  it("keeps pending, non-revoked grants, revoked claims and consumed capacity separate", () => {
    expect(summarizeClaims(claims)).toEqual({ claims: 5, pendingClaims: 1,
      grantedPlaces: 2, revokedClaims: 2, occupiedPlaces: 3, uniqueTesters: 1 });
  });

  it("scopes claims to the app, exact version or granted older-build inheritance", () => {
    expect(releaseAnalyticsClaimScope(release)).toEqual({
      inviteLink: { projectId: "project" },
      OR: [
        { inviteLink: { releaseId: null } },
        { inviteLink: { releaseId: "release" } },
        { grantedAt: { not: null }, inviteLink: { release: {
          publishedAt: { gte: now }, accessPolicy: { allowPreviousReleases: true },
        } } },
      ],
    });
    // No link status/date filter: closing a share link is not entitlement revocation.
    expect(JSON.stringify(releaseAnalyticsClaimScope(release))).not.toMatch(/expiresAt|revokedAt|deletedAt|status/);
  });
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.projects.mockResolvedValue([]);
  mocks.projectCount.mockResolvedValue(2);
  mocks.releaseCount.mockResolvedValue(3);
  mocks.claims.mockResolvedValue(claims);
  mocks.downloads.mockResolvedValue(events);
  mocks.downloadCount.mockResolvedValue(8);
  mocks.views.mockResolvedValue(events.filter((event) => event.userId));
  mocks.feedbackCount.mockResolvedValue(1);
});

describe("owner analytics query contracts", () => {
  it("preserves existing stats and adds globally deduplicated identity totals without per-user queries", async () => {
    const result = await getBuilderDashboard("builder");
    expect(result.stats).toMatchObject({ claims: 5, grantedPlaces: 2, uniqueTesters: 1,
      uniqueViews: 3, downloads: 8, uniqueDownloaders: 2, pendingClaims: 1, revokedClaims: 2,
      viewers: { accounts: 1, guests: 1, total: 2 }, downloaders: { accounts: 1, guests: 1, total: 2 } });
    expect(mocks.views).toHaveBeenCalledExactlyOnceWith({
      where: { userId: { not: null }, release: { project: { ownerId: "builder" } } },
      distinct: ["releaseId", "userId"],
      select: { releaseId: true, userId: true, user: { select: { isAnonymous: true } } },
    });
    expect(mocks.downloads.mock.calls[0][0].distinct).toEqual(["userId"]);
    expect(mocks.claims).toHaveBeenCalledTimes(1);
  });

  it("adds scoped analytics without replacing version-specific invites or event arrays", async () => {
    const source = { ...release, inviteLinks: [{ id: "version-invite" }],
      releaseViewEvents: events, downloadEvents: events };
    mocks.release.mockResolvedValue(source);
    const result = await getReleaseForOwner("app", "release", "builder");
    expect(mocks.release.mock.calls[0][0].where).toEqual({ id: "release", deletedAt: null,
      project: { slug: "app", ownerId: "builder", deletedAt: null } });
    expect(mocks.claims).toHaveBeenCalledExactlyOnceWith({ where: releaseAnalyticsClaimScope(release),
      select: { userId: true, grantedAt: true, revokedAt: true } });
    expect(result?.inviteLinks).toBe(source.inviteLinks);
    expect(result?.downloadEvents).toBe(source.downloadEvents);
    expect(result?.analytics).toMatchObject({ claims: 5, occupiedPlaces: 3, grantedPlaces: 2,
      viewers: { accounts: 1, guests: 1, total: 2 }, downloaders: { total: 2 } });
  });

  it("does not query claims before confirming release ownership", async () => {
    mocks.release.mockResolvedValue(null);
    expect(await getReleaseForOwner("app", "release", "other-builder")).toBeNull();
    expect(mocks.claims).not.toHaveBeenCalled();
  });
});

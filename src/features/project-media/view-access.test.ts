import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rate: vi.fn(), media: vi.fn(), user: vi.fn(), releases: vi.fn(), invite: vi.fn(), hash: vi.fn() }));
vi.mock("@/src/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/src/lib/db", () => ({ prisma: { projectMedia: { findFirst: mocks.media }, user: { findUnique: mocks.user }, release: { findMany: mocks.releases }, inviteLink: { findFirst: mocks.invite } } }));
vi.mock("@/src/lib/env", () => ({ getServerEnv: () => ({ BETTER_AUTH_URL: "https://app.example" }) }));
vi.mock("@/src/lib/rate-limit", () => ({ consumeRateLimit: mocks.rate }));
vi.mock("@/src/lib/invite", () => ({ hashInviteToken: mocks.hash }));
import { authorizeMediaRenewal } from "./view-access";

function request(headers: Record<string, string> = {}) { return new Request("https://app.example/api/project-media/m/url", { headers }); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.media.mockResolvedValue({ storageKey: "private/key", projectId: "p", project: { ownerId: "owner" } });
  mocks.session.mockResolvedValue(null); mocks.invite.mockResolvedValue(null); mocks.hash.mockReturnValue("hashed-token");
  mocks.user.mockResolvedValue({ wallets: [], testerMemberships: [], testerAccesses: [], inviteClaims: [], deviceProfiles: [] });
  mocks.releases.mockResolvedValue([]);
});

describe("expired image renewal reauthorizes instead of creating public media", () => {
  it("rejects anonymous, cross-origin and missing resources without signing", async () => {
    await expect(authorizeMediaRenewal(request(), "m")).rejects.toMatchObject({ status: 404 });
    await expect(authorizeMediaRenewal(request({ origin: "https://evil.example" }), "m")).rejects.toMatchObject({ status: 404 });
    await expect(authorizeMediaRenewal(request({ "sec-fetch-site": "cross-site" }), "m")).rejects.toMatchObject({ status: 404 });
    mocks.media.mockResolvedValueOnce(null);
    await expect(authorizeMediaRenewal(request(), "m")).rejects.toMatchObject({ status: 404 });
    expect(mocks.media).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "m", status: "READY", deletedAt: null, project: { deletedAt: null } } }));
  });
  it("allows the current owner but not merely an authenticated stranger", async () => {
    mocks.session.mockResolvedValueOnce({ user: { id: "owner" } });
    await expect(authorizeMediaRenewal(request(), "m")).resolves.toBe("private/key");
    mocks.session.mockResolvedValueOnce({ user: { id: "stranger" } });
    await expect(authorizeMediaRenewal(request(), "m")).rejects.toMatchObject({ status: 404 });
  });
  it("uses canViewMetadata rather than download entitlement and honors project revocation", async () => {
    mocks.session.mockResolvedValue({ user: { id: "tester" } });
    mocks.releases.mockResolvedValue([{ id: "r", publishedAt: new Date(), accessPolicy: { requireInviteAcceptance: false, requireLinkedWallet: true, walletEntries: [] } }]);
    // Wallet missing blocks downloads, not metadata in the existing evaluator.
    await expect(authorizeMediaRenewal(request(), "m")).resolves.toBe("private/key");
    mocks.user.mockResolvedValueOnce({ wallets: [], testerMemberships: [], testerAccesses: [{ revokedAt: new Date() }], inviteClaims: [], deviceProfiles: [] });
    await expect(authorizeMediaRenewal(request(), "m")).rejects.toMatchObject({ status: 404 });
    mocks.releases.mockResolvedValue([{ id: "r", publishedAt: new Date(), accessPolicy: { requireInviteAcceptance: true, walletEntries: [] } }]);
    await expect(authorizeMediaRenewal(request(), "m")).rejects.toMatchObject({ status: 404 });
  });
  it("checks actual invite possession, project scope, expiry and revocation on anonymous previews", async () => {
    const token = "valid-bearer-token-1234567890";
    const valid = request({ referer: `https://app.example/invite/${token}` });
    await expect(authorizeMediaRenewal(valid, "m")).rejects.toMatchObject({ status: 404 });
    mocks.invite.mockResolvedValueOnce({ id: "valid-invite" });
    await expect(authorizeMediaRenewal(valid, "m")).resolves.toBe("private/key");
    expect(mocks.invite).toHaveBeenLastCalledWith({ where: expect.objectContaining({ projectId: "p", tokenHash: "hashed-token", revokedAt: null, project: { deletedAt: null }, AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }], OR: [{ releaseId: null }, { release: { deletedAt: null } }] }), select: { id: true } });
    const calls = mocks.invite.mock.calls.length;
    await expect(authorizeMediaRenewal(request({ referer: `https://evil.example/invite/${token}` }), "m")).rejects.toMatchObject({ status: 404 });
    expect(mocks.invite).toHaveBeenCalledTimes(calls);
  });
});

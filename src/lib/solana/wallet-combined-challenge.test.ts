import bs58 from "bs58";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/wallet/challenge/route";
import { buildWalletChallengeMessage } from "./wallet";

const mocks = vi.hoisted(() => ({ release: vi.fn(), invite: vi.fn(), create: vi.fn(), rate: vi.fn() }));
vi.mock("@/src/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  release: { findFirst: mocks.release }, inviteLink: { findFirst: mocks.invite }, walletChallenge: { create: mocks.create },
} }));
vi.mock("@/src/lib/invite", () => ({ hashInviteToken: (s: string) => `hash:${s}` }));
vi.mock("@/src/lib/env", () => ({ getServerEnv: () => ({ BETTER_AUTH_URL: "https://wallet.example.test" }) }));
vi.mock("@/src/lib/rate-limit", () => ({ consumeRateLimit: mocks.rate, RATE_LIMITS: { wallet: { limit: 10, windowMs: 600_000 } } }));

const releaseId = "cm123456789012345678901234";
const address = bs58.encode(new Uint8Array(32).fill(3));
const request = (extra: object) => POST(new Request("https://wallet.example.test/api/wallet/challenge", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ address, purpose: "SIGN_IN_AND_VERIFY_SGT", ...extra }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockImplementation(async ({ data }) => ({ id: "challenge", message: data.message }));
});

describe("server-authorized combined challenge", () => {
  it("binds a published SGT-required release into one explicit dual-purpose message", async () => {
    mocks.release.mockResolvedValue({ id: releaseId });
    const response = await request({ sgtContext: { releaseId } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.message).toContain("Sign in to SeekerHub and authorize a fresh on-chain Seeker Genesis Token ownership check for this wallet");
    expect(result.message).toContain(`SGT access context: release:${releaseId}`);
    expect(result.message).toContain("does not prove that the current device is a Seeker");
    expect(mocks.release).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: releaseId, status: "PUBLISHED", deletedAt: null, project: { deletedAt: null }, accessPolicy: { requireVerifiedSeeker: true },
    }) }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ purpose: "SIGN_IN_AND_VERIFY_SGT", address }) }));
    expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({ action: "wallet.challenge" }));
  });

  it("validates active invitation policy and binds IDs without exposing the bearer token", async () => {
    const token = "secret-invite-token-test-only";
    mocks.invite.mockResolvedValue({ id: "invite-id", projectId: "project-id", releaseId: null });
    mocks.release.mockResolvedValue({ id: releaseId });
    const response = await request({ sgtContext: { inviteToken: token } });
    expect(response.status).toBe(200);
    const { message } = await response.json();
    expect(message).toContain(`SGT access context: invite:invite-id;release:${releaseId}`);
    expect(message).not.toContain(token);
    expect(mocks.invite).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      tokenHash: `hash:${token}`, revokedAt: null, project: { deletedAt: null }, OR: expect.any(Array),
    }) }));
    expect(mocks.release).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      projectId: "project-id", accessPolicy: { requireVerifiedSeeker: true },
    }) }));
  });

  it.each([
    {}, { sgtContext: {} }, { sgtContext: { releaseId, inviteToken: "x".repeat(20) } },
    { purpose: "SIGN_IN", sgtContext: { releaseId } },
  ])("rejects missing, ambiguous, or unintended context %j before issuing proof", async (input) => {
    expect((await request(input)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects releases without published verified-SGT policy", async () => {
    mocks.release.mockResolvedValue(null);
    const response = await request({ sgtContext: { releaseId } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "SGT_CONTEXT_NOT_REQUIRED" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects inactive or nonexistent invites without issuing a combined proof", async () => {
    mocks.invite.mockResolvedValue(null);
    expect((await request({ sgtContext: { inviteToken: "x".repeat(20) } })).status).toBe(400);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not upgrade ordinary SIGN_IN or look up SGT policies", async () => {
    const response = await request({ purpose: "SIGN_IN" });
    expect(response.status).toBe(200);
    expect((await response.json()).message).not.toContain("SGT access context");
    expect(mocks.invite).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("cannot build the combined message without validated context", () => {
    expect(() => buildWalletChallengeMessage({ address, nonce: "nonce", appUrl: "https://wallet.example.test",
      purpose: "SIGN_IN_AND_VERIFY_SGT", expiresAt: new Date() })).toThrow("validated SGT context");
  });
});

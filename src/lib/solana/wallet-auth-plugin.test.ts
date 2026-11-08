import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/src/lib/errors";
import { solanaWalletAuthPlugin } from "./wallet-auth-plugin";

const mocks = vi.hoisted(() => ({ account: vi.fn(), cookie: vi.fn(), rate: vi.fn(), refresh: vi.fn(), reconcile: vi.fn(), session: vi.fn() }));
vi.mock("better-auth/api", () => ({
  createAuthEndpoint: (_path: unknown, _options: unknown, fn: unknown) => fn,
  getSessionFromCtx: async () => ({ user: { id: "guest" } }),
  APIError: class extends Error { constructor(_status: unknown, body: { message: string }) { super(body.message); } },
}));
vi.mock("better-auth/cookies", () => ({ setSessionCookie: mocks.cookie }));
vi.mock("./wallet-account", () => ({ continueWalletAccount: mocks.account }));
vi.mock("@/src/lib/invite-access", () => ({ reconcilePendingInviteGrants: mocks.reconcile }));
vi.mock("@/src/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("./sgt-verification", () => ({ consumeSgtRateLimit: mocks.rate, refreshWalletSgtVerification: mocks.refresh,
  walletSgtFailure: (error: { code: string; message: string }) => ({ verified: false, status: "unavailable", code: error.code, message: error.message }),
}));

const user = { id: "recovered" };
async function login(purpose = "SIGN_IN_AND_VERIFY_SGT") {
  const handler = solanaWalletAuthPlugin().endpoints.signInSolanaWallet as unknown as (ctx: unknown) => Promise<unknown>;
  return handler({ body: { purpose, address: "address", challengeId: "challenge", signature: "signature" },
    request: new Request("http://localhost/api/auth/sign-in/solana-wallet"),
    context: { internalAdapter: { createSession: mocks.session } }, json: (body: unknown) => body });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.account.mockResolvedValue(user);
  mocks.session.mockResolvedValue({ id: "session", userId: user.id });
  mocks.refresh.mockResolvedValue({ verified: true, status: "verified" });
});

describe("wallet auth before independent SGT side effect", () => {
  it("commits authentication and cookie before rate-limited fresh SGT lookup on the recovered account", async () => {
    expect(await login()).toMatchObject({ success: true, user, sgt: { verified: true } });
    expect(mocks.account).toHaveBeenCalledWith(expect.objectContaining({ currentUserId: "guest", purpose: "SIGN_IN_AND_VERIFY_SGT" }));
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(user.id, "address");
    expect(mocks.account.mock.invocationCallOrder[0]).toBeLessThan(mocks.session.mock.invocationCallOrder[0]);
    expect(mocks.cookie.mock.invocationCallOrder[0]).toBeLessThan(mocks.rate.mock.invocationCallOrder[0]);
    expect(mocks.rate.mock.invocationCallOrder[0]).toBeLessThan(mocks.refresh.mock.invocationCallOrder[0]);
  });

  it("preserves login and cookie on RPC failure without claiming SGT success", async () => {
    mocks.refresh.mockRejectedValue(new AppError("RPC unavailable", 503, "SGT_RPC_UNAVAILABLE"));
    expect(await login()).toMatchObject({ success: true, user, sgt: { verified: false, code: "SGT_RPC_UNAVAILABLE" } });
    expect(mocks.cookie).toHaveBeenCalledOnce();
    expect(mocks.reconcile).toHaveBeenCalledWith(user.id);
  });

  it("preserves login without RPC when the SGT rate limit rejects", async () => {
    mocks.rate.mockRejectedValue(new AppError("Wait", 429, "RATE_LIMITED"));
    expect(await login()).toMatchObject({ success: true, sgt: { verified: false, code: "RATE_LIMITED" } });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.cookie).toHaveBeenCalledOnce();
  });

  it("never checks or refreshes cached SGT on normal SIGN_IN", async () => {
    expect(await login("SIGN_IN")).toEqual({ success: true, user });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });

  it("does not reach SGT or session creation when authentication fails", async () => {
    mocks.account.mockRejectedValue(new AppError("Invalid signature", 400, "INVALID_WALLET_SIGNATURE"));
    await expect(login()).rejects.toThrow("Invalid signature");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not grant SGT when session creation fails", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(login()).rejects.toThrow("Unable to create wallet session");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

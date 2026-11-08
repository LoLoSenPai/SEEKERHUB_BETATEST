import bs58 from "bs58";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/wallet/verify-seeker/route";
import { buildWalletChallengeMessage } from "./wallet";

const mocks = vi.hoisted(() => ({ challenge: vi.fn(), claim: vi.fn(), wallet: vi.fn(), rate: vi.fn(), refresh: vi.fn() }));
vi.mock("@/src/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: "tester" } }) } } }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  walletChallenge: { findUnique: mocks.challenge, updateMany: mocks.claim }, wallet: { findFirst: mocks.wallet },
} }));
vi.mock("@/src/lib/solana/sgt-verification", () => ({ consumeSgtRateLimit: mocks.rate, refreshWalletSgtVerification: mocks.refresh }));
vi.mock("@/src/lib/env", () => ({ getServerEnv: () => ({ BETTER_AUTH_URL: "https://wallet.example.test" }) }));

function proof(purpose: "VERIFY_SGT" | "SIGN_IN" | "SIGN_IN_AND_VERIFY_SGT" = "VERIFY_SGT", transform = (s: string) => s) {
  const key = nacl.sign.keyPair();
  const address = bs58.encode(key.publicKey);
  const expiresAt = new Date(Date.now() + 600_000);
  const message = transform(buildWalletChallengeMessage({ address, nonce: "new-nonce", purpose,
    appUrl: "https://wallet.example.test", expiresAt, sgtContext: "release:release-id" }));
  const challenge = { id: "cm123456789012345678901234", address, message, purpose, userId: "tester", usedAt: null as Date | null, expiresAt };
  mocks.challenge.mockResolvedValue(challenge);
  const body = { challengeId: challenge.id, address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), key.secretKey)) };
  return { challenge, body, submit: () => POST(new Request("https://wallet.example.test/api/wallet/verify-seeker", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.wallet.mockResolvedValue({ id: "wallet" });
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.refresh.mockResolvedValue({ verified: true, status: "verified" });
});

describe("explicit linked-wallet SGT route", () => {
  it.each(["SIGN_IN", "SIGN_IN_AND_VERIFY_SGT"] as const)("never reuses %s as independent SGT proof", async (purpose) => {
    const { submit } = proof(purpose);
    expect((await submit()).status).toBe(404);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(["domain", "uri", "signature", "session", "address", "used", "expired"])("rejects %s without reaching SGT RPC", async (kind) => {
    const { challenge, body, submit } = proof("VERIFY_SGT", (s) => kind === "domain" ? s.replace("wallet.example.test", "other.example.test")
      : kind === "uri" ? s.replace("URI: https://wallet.example.test", "URI: https://other.example.test") : s);
    if (kind === "signature") body.signature = "0".repeat(88);
    if (kind === "session") challenge.userId = "other-user";
    if (kind === "address") body.address = bs58.encode(nacl.sign.keyPair().publicKey);
    if (kind === "used") challenge.usedAt = new Date();
    if (kind === "expired") challenge.expiresAt = new Date(0);
    expect((await submit()).status).toBeGreaterThanOrEqual(400);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("uses the same refresh service only after rate limit, signature and atomic proof consumption", async () => {
    const { submit, body } = proof();
    expect((await submit()).status).toBe(200);
    expect(mocks.rate).toHaveBeenCalledWith(expect.any(Request), "tester");
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith("tester", body.address);
    expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.refresh.mock.invocationCallOrder[0]);
  });

  it("does not refresh if another request consumed the proof concurrently", async () => {
    const { submit } = proof();
    mocks.claim.mockResolvedValue({ count: 0 });
    expect((await submit()).status).toBe(409);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

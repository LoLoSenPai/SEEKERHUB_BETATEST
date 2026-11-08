import bs58 from "bs58";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWalletChallengeMessage } from "./wallet";
import { continueWalletAccount } from "./wallet-account";
import type { WalletAuthPurpose } from "./wallet-types";

const mocks = vi.hoisted(() => ({
  challenge: { findUnique: vi.fn(), updateMany: vi.fn() },
  wallet: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  audit: vi.fn(),
}));
vi.mock("@/src/lib/db", () => ({ prisma: { $transaction: async (fn: (tx: unknown) => unknown) => fn({
  $executeRaw: vi.fn(), $queryRaw: vi.fn(), walletChallenge: mocks.challenge,
  wallet: mocks.wallet, user: mocks.user, auditLog: { create: mocks.audit },
}) } }));
vi.mock("@/src/lib/env", () => ({ getServerEnv: () => ({ BETTER_AUTH_URL: "https://wallet.example.test" }) }));
vi.mock("@/src/lib/account-linking", () => ({ transferAnonymousAccountInTransaction: vi.fn() }));

const user = { id: "tester", isAnonymous: false };
function proof(purpose: WalletAuthPurpose = "SIGN_IN_AND_VERIFY_SGT", transform = (s: string) => s) {
  const key = nacl.sign.keyPair();
  const address = bs58.encode(key.publicKey);
  const expiresAt = new Date(Date.now() + 600_000);
  const message = transform(buildWalletChallengeMessage({ address, nonce: "fresh-nonce", appUrl: "https://wallet.example.test",
    purpose, expiresAt, sgtContext: "release:release-id" }));
  const challenge = { id: "challenge", address, message, purpose, userId: null as string | null, usedAt: null as Date | null, expiresAt };
  mocks.challenge.findUnique.mockResolvedValue(challenge);
  mocks.challenge.updateMany.mockImplementation(async () => {
    if (challenge.usedAt) return { count: 0 };
    challenge.usedAt = new Date();
    return { count: 1 };
  });
  mocks.wallet.findUnique.mockResolvedValue({ id: "wallet", address, userId: user.id,
    seekerGenesisVerificationExpiresAt: new Date(0) });
  return { challenge, input: { challengeId: challenge.id, address, currentUserId: null as string | null, purpose,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), key.secretKey)) } };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.findUniqueOrThrow.mockResolvedValue(user);
  mocks.user.findUnique.mockResolvedValue(user);
});

describe("explicit combined authentication proof", () => {
  it.each(["SIGN_IN", "SIGN_IN_AND_VERIFY_SGT"] as const)("authenticates %s once and never refreshes cached SGT proof during account recovery", async (purpose) => {
    const { input } = proof(purpose);
    await expect(continueWalletAccount(input)).resolves.toEqual(user);
    await expect(continueWalletAccount(input)).rejects.toMatchObject({ code: "CHALLENGE_USED" });
    expect(mocks.wallet.update).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it.each(["SIGN_IN", "SIGN_IN_AND_VERIFY_SGT"] as const)("rejects cross-purpose use of %s", async (purpose) => {
    const { input } = proof(purpose);
    input.purpose = purpose === "SIGN_IN" ? "SIGN_IN_AND_VERIFY_SGT" : "SIGN_IN";
    await expect(continueWalletAccount(input)).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
    expect(mocks.challenge.updateMany).not.toHaveBeenCalled();
  });

  it("does not infer combined purpose when omitted", async () => {
    const { input } = proof();
    await expect(continueWalletAccount({ ...input, purpose: undefined })).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  });

  it.each(["host", "uri", "signature", "session", "address", "expired", "used"])("rejects invalid %s before consuming proof", async (kind) => {
    const { input, challenge } = proof("SIGN_IN_AND_VERIFY_SGT", (s) => kind === "host"
      ? s.replace("wallet.example.test", "attacker.example.test")
      : kind === "uri" ? s.replace("URI: https://wallet.example.test", "URI: https://attacker.example.test") : s);
    if (kind === "signature") input.signature = bs58.encode(new Uint8Array(64));
    if (kind === "session") input.currentUserId = "other-session";
    if (kind === "address") input.address = bs58.encode(nacl.sign.keyPair().publicKey);
    if (kind === "expired") challenge.expiresAt = new Date(0);
    if (kind === "used") challenge.usedAt = new Date();
    await expect(continueWalletAccount(input)).rejects.toHaveProperty("code");
    expect(mocks.challenge.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

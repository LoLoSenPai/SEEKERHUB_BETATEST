import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/src/lib/errors";
import { SeekerVerificationUnavailableError } from "./sgt";
import { consumeSgtRateLimit, refreshWalletSgtVerification, walletSgtFailure } from "./sgt-verification";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), transaction: vi.fn(), chain: vi.fn(), reconcile: vi.fn(), rate: vi.fn(),
}));
vi.mock("@/src/lib/db", () => ({ prisma: { wallet: { findFirst: mocks.findFirst }, $transaction: mocks.transaction } }));
vi.mock("./sgt", () => ({ verifySeekerGenesisOwnership: mocks.chain,
  SeekerVerificationUnavailableError: class extends Error {} }));
vi.mock("@/src/lib/invite-access", () => ({ reconcilePendingInviteGrants: mocks.reconcile }));
vi.mock("@/src/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/src/lib/rate-limit", () => ({ consumeRateLimit: mocks.rate, RATE_LIMITS: { seeker: { limit: 5, windowMs: 600_000 } } }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findFirst.mockResolvedValue({ id: "wallet", userId: "tester", address: "address", seekerGenesisVerificationExpiresAt: new Date(0) });
  mocks.chain.mockResolvedValue({ verified: true, mintAddress: "mint" });
  mocks.transaction.mockImplementation(async (fn) => fn({ wallet: { findUnique: mocks.findUnique, update: mocks.update } }));
});

describe("shared SGT refresh", () => {
  it("reads the chain even with cached proof and persists a fresh 24h result before reconciling pending grants", async () => {
    const start = Date.now();
    const result = await refreshWalletSgtVerification("tester", "address");
    expect(result).toMatchObject({ status: "verified", verified: true, mintAddress: "mint" });
    expect(+new Date(result.expiresAt!)).toBeGreaterThanOrEqual(start + 86_400_000);
    expect(mocks.chain).toHaveBeenCalledExactlyOnceWith("address");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ seekerGenesisMintAddress: "mint" }) }));
    expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith("tester");
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.reconcile.mock.invocationCallOrder[0]);
  });

  it("does not refresh, grant, or clear cached proof on RPC failure", async () => {
    mocks.chain.mockRejectedValue(new SeekerVerificationUnavailableError());
    await expect(refreshWalletSgtVerification("tester", "address")).rejects.toBeInstanceOf(SeekerVerificationUnavailableError);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("clears cached verification only after a fresh negative chain result", async () => {
    mocks.chain.mockResolvedValue({ verified: false, mintAddress: null });
    expect(await refreshWalletSgtVerification("tester", "address")).toMatchObject({ status: "not_found", verified: false, expiresAt: null });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "wallet", userId: "tester", address: "address" }, data: {
      seekerGenesisVerifiedAt: null, seekerGenesisVerificationExpiresAt: null, seekerGenesisMintAddress: null,
    } });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("rejects another tester's still-valid mint without granting access", async () => {
    mocks.findUnique.mockResolvedValue({ id: "other", userId: "other-tester", seekerGenesisVerificationExpiresAt: new Date(Date.now() + 60_000) });
    await expect(refreshWalletSgtVerification("tester", "address")).rejects.toMatchObject({ code: "SGT_ALREADY_ASSIGNED" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("releases an old mint assignment before assigning its fresh owner", async () => {
    mocks.findUnique.mockResolvedValue({ id: "old", userId: "other-tester", seekerGenesisVerificationExpiresAt: new Date(0) });
    await refreshWalletSgtVerification("tester", "address");
    expect(mocks.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: "old" }, data: expect.objectContaining({ seekerGenesisMintAddress: null }) }));
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it("maps the DB mint uniqueness race to a conflict", async () => {
    mocks.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }));
    await expect(refreshWalletSgtVerification("tester", "address")).rejects.toMatchObject({ code: "SGT_ALREADY_ASSIGNED" });
  });

  it("checks linked ownership before RPC", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(refreshWalletSgtVerification("tester", "address")).rejects.toMatchObject({ code: "WALLET_NOT_LINKED" });
    expect(mocks.chain).not.toHaveBeenCalled();
  });

  it("uses the same per-user SGT rate bucket for either endpoint", async () => {
    const request = new Request("http://localhost/test");
    await consumeSgtRateLimit(request, "tester");
    expect(mocks.rate).toHaveBeenCalledWith({ request, userId: "tester", action: "wallet.verify-seeker", limit: 5, windowMs: 600_000 });
    expect(walletSgtFailure(new AppError("Wait", 429, "RATE_LIMITED"))).toMatchObject({ verified: false, status: "rate_limited" });
    expect(walletSgtFailure(new SeekerVerificationUnavailableError())).toMatchObject({ verified: false, status: "unavailable", code: "SGT_RPC_UNAVAILABLE" });
  });
});

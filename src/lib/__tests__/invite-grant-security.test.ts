import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), transaction: vi.fn(), lock: vi.fn(), fresh: vi.fn(), user: vi.fn(), releases: vi.fn(),
  count: vi.fn(), grant: vi.fn(), membership: vi.fn(),
}));
vi.mock("@/src/lib/db", () => ({ prisma: { inviteClaim: { findMany: mocks.list }, $transaction: mocks.transaction } }));
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";

const invite = () => ({ id: "invite", projectId: "project", releaseId: "release", testerGroupId: "group",
  project: { deletedAt: null }, testerGroup: { projectId: "project" }, revokedAt: null as Date | null,
  expiresAt: null as Date | null, maxUses: 1 });
let link: ReturnType<typeof invite>;
let identity: { wallets: Array<{ address: string; seekerGenesisVerificationExpiresAt: Date | null }>;
  testerAccesses: Array<{ revokedAt: Date | null }>;
  testerMemberships: Array<{ testerGroupId: string; revokedAt: Date | null }> };
const tx = { $queryRaw: mocks.lock, inviteClaim: { findUnique: mocks.fresh, count: mocks.count, update: mocks.grant },
  user: { findUnique: mocks.user }, release: { findMany: mocks.releases }, testerMembership: { create: mocks.membership } };

beforeEach(() => {
  vi.resetAllMocks();
  link = invite();
  identity = { wallets: [{ address: "allowed", seekerGenesisVerificationExpiresAt: new Date(Date.now() + 60_000) }],
    testerAccesses: [], testerMemberships: [] };
  mocks.list.mockResolvedValue([{ id: "claim", inviteLinkId: "invite" }]);
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  mocks.fresh.mockImplementation(async () => ({ id: "claim", userId: "user", inviteLinkId: "invite", grantedAt: null,
    revokedAt: null, inviteLink: link }));
  mocks.user.mockImplementation(async () => identity);
  mocks.releases.mockResolvedValue([{ accessPolicy: { testerGroupId: "group", requireLinkedWallet: true,
    requireVerifiedSeeker: true, walletEntries: [{ address: "allowed" }] } }]);
  mocks.count.mockResolvedValue(0);
});

describe("transactional invitation grants", () => {
  it("reads identity and policy only inside a serializable, link-locked transaction", async () => {
    await reconcilePendingInviteGrants("user", "project");
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(mocks.releases).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      projectId: "project", id: "release", status: "PUBLISHED", deletedAt: null,
    }) }));
    expect(mocks.grant).toHaveBeenCalledOnce();
    expect(mocks.membership).toHaveBeenCalledOnce();
  });
  it.each(["revoked", "expired", "deleted", "access-revoked", "membership-revoked", "wallet-removed", "sgt-expired", "full"])(
    "does not allocate a seat when %s changes after the work list is read", async (condition) => {
      if (condition === "revoked") link.revokedAt = new Date();
      if (condition === "expired") link.expiresAt = new Date(Date.now() - 1);
      if (condition === "deleted") Object.assign(link.project, { deletedAt: new Date() });
      if (condition === "access-revoked") identity.testerAccesses = [{ revokedAt: new Date() }];
      if (condition === "membership-revoked") identity.testerMemberships = [{ testerGroupId: "group", revokedAt: new Date() }];
      if (condition === "wallet-removed") identity.wallets = [];
      if (condition === "sgt-expired") identity.wallets[0].seekerGenesisVerificationExpiresAt = new Date(Date.now() - 1);
      if (condition === "full") mocks.count.mockResolvedValue(1);
      await reconcilePendingInviteGrants("user");
      expect(mocks.grant).not.toHaveBeenCalled();
      expect(mocks.membership).not.toHaveBeenCalled();
    },
  );
  it("rechecks a policy changed since claim creation", async () => {
    mocks.releases.mockResolvedValue([{ accessPolicy: { testerGroupId: "different-group", walletEntries: [] } }]);
    await reconcilePendingInviteGrants("user");
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("leaves already-granted seats unchanged even on a closed link", async () => {
    mocks.fresh.mockResolvedValue({ userId: "user", grantedAt: new Date(), inviteLink: { ...link, revokedAt: new Date() } });
    await reconcilePendingInviteGrants("user");
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("rechecks eligibility on conflict retry instead of reusing the old decision", async () => {
    mocks.transaction.mockImplementationOnce(async (callback) => {
      await callback(tx);
      identity.wallets = [];
      throw { code: "P2034" };
    });
    await reconcilePendingInviteGrants("user");
    expect(mocks.user).toHaveBeenCalledTimes(2);
    expect(mocks.grant).toHaveBeenCalledTimes(1);
  });
});

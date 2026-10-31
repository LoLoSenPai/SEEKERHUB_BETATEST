import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), transaction: vi.fn(), release: vi.fn(), update: vi.fn(),
  upsert: vi.fn(), removeWallets: vi.fn(), addWallets: vi.fn(), audit: vi.fn(), group: vi.fn(), pending: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/src/lib/session", () => ({ requireBuilderSession: mocks.session }));
vi.mock("@/src/lib/invite-access", () => ({ reconcilePendingInviteGrants: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: { $transaction: mocks.transaction,
  release: { findFirst: mocks.release, update: mocks.update }, auditLog: { create: mocks.audit }, inviteClaim: { findMany: mocks.pending } } }));
import { setReleaseArchivedAction, updateReleasePolicyAction } from "@/src/features/releases/actions";

const address = "11111111111111111111111111111111";
const previous = { requireInviteAcceptance: true, testerGroupId: "group", requireLinkedWallet: true,
  requireVerifiedSeeker: true, allowPreviousReleases: false, walletEntries: [{ address }] };
const tx = { release: { findFirst: mocks.release }, accessPolicy: { upsert: mocks.upsert },
  accessPolicyWalletEntry: { deleteMany: mocks.removeWallets, createMany: mocks.addWallets },
  auditLog: { create: mocks.audit }, testerGroup: { findFirst: mocks.group } };
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ releaseId: "release", projectSlug: "app", accessPreset: "custom",
    testerGroupId: "group", walletAllowlist: address, requireInviteAcceptance: "on", requireLinkedWallet: "on", requireVerifiedSeeker: "on" })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "builder" } });
  mocks.release.mockResolvedValue({ id: "release", projectId: "project", project: { slug: "app" }, status: "PUBLISHED", accessPolicy: previous });
  mocks.transaction.mockImplementation(async (callback) => typeof callback === "function" ? callback(tx) : Promise.all(callback));
  mocks.upsert.mockResolvedValue({ id: "policy" });
  mocks.group.mockResolvedValue({ id: "group" });
  mocks.pending.mockResolvedValue([]);
});

describe("access policy action", () => {
  it("roundtrips every combined constraint and returns success state", async () => {
    const result = await updateReleasePolicyAction({ status: "idle", message: "" }, form());
    expect(result.status).toBe("success");
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({
      requireInviteAcceptance: true, testerGroupId: "group", requireLinkedWallet: true, requireVerifiedSeeker: true,
    }) }));
    expect(mocks.addWallets).toHaveBeenCalledWith({ data: [{ accessPolicyId: "policy", address }] });
  });
  it("returns a clear error without writing when broadening is not confirmed", async () => {
    const data = form(); data.set("testerGroupId", "");
    const result = await updateReleasePolicyAction({ status: "idle", message: "" }, data);
    expect(result).toEqual({ status: "error", message: expect.stringContaining("Confirm the audience broadening") });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("saves an explicitly confirmed broadening", async () => {
    const data = form(); data.set("testerGroupId", ""); data.set("confirmAudienceBroadening", "on");
    expect((await updateReleasePolicyAction({ status: "idle", message: "" }, data)).status).toBe("success");
  });
  it("returns validation errors and keeps the direct native form signature", async () => {
    const data = form(); data.set("walletAllowlist", "invalid-wallet");
    expect(await updateReleasePolicyAction({ status: "idle", message: "" }, data)).toEqual({ status: "error", message: "Invalid Solana address." });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(await updateReleasePolicyAction(form())).toBeUndefined();
  });
  it("refuses another project's tester group", async () => {
    mocks.group.mockResolvedValue(null);
    expect((await updateReleasePolicyAction({ status: "idle", message: "" }, form())).message).toContain("not found in this project");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rejects custom access without an invitation or allowlist even when broadening is confirmed", async () => {
    const data = form();
    data.delete("requireInviteAcceptance");
    data.delete("requireLinkedWallet");
    data.delete("requireVerifiedSeeker");
    data.set("testerGroupId", "");
    data.set("walletAllowlist", "");
    data.set("confirmAudienceBroadening", "on");
    const state = await updateReleasePolicyAction({ status: "idle", message: "" }, data);
    expect(state).toEqual({ status: "error", message: expect.stringContaining("Require an invite link") });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("reports an explicit claim retry if post-save reconciliation fails", async () => {
    mocks.pending.mockRejectedValue(new Error("Unavailable"));
    const state = await updateReleasePolicyAction({ status: "idle", message: "" }, form());
    expect(state.status).toBe("success");
    expect(state.message).toContain("retry claiming their invitation explicitly");
    expect(state.message).not.toContain("next visit");
  });
});

describe("archive endpoint is not a publish endpoint", () => {
  it.each(["true", "false"])("refuses draft transition with archive=%s", async (archive) => {
    mocks.release.mockResolvedValue({ id: "release", status: "DRAFT" });
    const data = form(); data.set("archive", archive);
    await expect(setReleaseArchivedAction(data)).rejects.toThrow("publish endpoint");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([["PUBLISHED", "true", "ARCHIVED"], ["ARCHIVED", "false", "PUBLISHED"]])(
    "allows %s -> %s only with an atomic source-state guard", async (status, archive, next) => {
      mocks.release.mockResolvedValue({ id: "release", status });
      const data = form(); data.set("archive", archive);
      await setReleaseArchivedAction(data);
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
        status, deletedAt: null, project: { ownerId: "builder", deletedAt: null },
      }), data: { status: next } }));
    },
  );
});

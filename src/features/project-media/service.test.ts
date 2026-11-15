import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), queryRaw: vi.fn(), put: vi.fn(),
  project: { findFirst: vi.fn() },
  profile: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  media: { findFirst: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  tasks: { create: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/src/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/src/lib/storage/project-media", () => ({ uploadNormalizedMedia: mocks.put }));
import { deleteProjectMedia, reserveMediaQuota, storeProjectMedia } from "./service";

const tx = { $queryRaw: mocks.queryRaw, appProject: mocks.project, builderProfile: mocks.profile, projectMedia: mocks.media, storageDeletionTask: mocks.tasks };
const input = { userId: "owner", projectId: "project", kind: "ICON" as const, bytes: 100, width: 512, height: 512 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (action) => action(tx));
  mocks.queryRaw.mockImplementation(async (sql) => sql.join("").includes('FROM "AppProject"')
    ? [{ id: "project" }]
    : [await mocks.media.create.mock.results.at(-1)?.value]);
  mocks.profile.findUnique.mockResolvedValue({ status: "ACTIVE", usedStorageBytes: 0n, reservedStorageBytes: 0n, maxStorageBytes: 10_000_000n });
  mocks.profile.updateMany.mockResolvedValue({ count: 1 });
  mocks.media.findMany.mockResolvedValue([]);
  mocks.media.create.mockImplementation(async ({ data }) => ({ ...data, status: "PENDING", readyAt: null, deletedAt: null }));
});

describe("persistent media quota and lifecycle", () => {
  it("checks ownership under the project lock before reserving", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await expect(reserveMediaQuota(input)).rejects.toMatchObject({ status: 404 });
    expect(mocks.profile.findUnique).not.toHaveBeenCalled();
    expect(mocks.profile.update).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
  });
  it("checks owner and soft deletion in one parameterized locking read", async () => {
    await reserveMediaQuota(input);
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    const [sql, ...values] = mocks.queryRaw.mock.calls[0];
    expect(sql.join("?").replace(/\s+/g, " ").trim()).toBe('SELECT id FROM "AppProject" WHERE id = ? AND "ownerId" = ? AND "deletedAt" IS NULL FOR UPDATE');
    expect(values).toEqual(["project", "owner"]);
    expect(mocks.project.findFirst).not.toHaveBeenCalled();
  });
  it("uses exactly three locking reads per upload and preserves finalization ordering", async () => {
    mocks.put.mockImplementation(async () => {
      expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
      expect(mocks.profile.findUnique).toHaveBeenCalledTimes(2);
      expect(mocks.tasks.create).toHaveBeenCalledOnce();
      expect(mocks.profile.updateMany).not.toHaveBeenCalled();
    });
    await storeProjectMedia({ ...input, data: Buffer.alloc(100) });
    const reserved = await mocks.media.create.mock.results[0].value;
    const [sql, ...values] = mocks.queryRaw.mock.calls[2];
    expect(sql.join("?").replace(/\s+/g, " ").trim()).toBe('SELECT id, "projectId", status, "expiresAt", "storageKey", "replacesId", "fileSizeBytes" FROM "ProjectMedia" WHERE id = ? FOR UPDATE');
    expect(values).toEqual([reserved.id]);
    expect(mocks.project.findFirst).not.toHaveBeenCalled();
    expect(mocks.media.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.profile.updateMany).toHaveBeenCalledWith({
      where: { userId: "owner", reservedStorageBytes: { gte: 100n } },
      data: { reservedStorageBytes: { decrement: 100n }, usedStorageBytes: { increment: 100n } },
    });
    expect(mocks.transaction).toHaveBeenNthCalledWith(2, expect.any(Function), { timeout: 45_000, maxWait: 5_000 });
  });
  it.each([
    ["missing", []],
    ["expired", [{ status: "PENDING", expiresAt: new Date(0) }]],
    ["already finalized", [{ status: "READY", expiresAt: new Date(Date.now() + 60_000) }]],
  ])("rejects a %s locked reservation before PUT", async (_label, rows) => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "project" }])
      .mockResolvedValueOnce([{ id: "project" }]).mockResolvedValueOnce(rows);
    await expect(storeProjectMedia({ ...input, data: Buffer.alloc(100) })).rejects.toThrow();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.profile.updateMany).not.toHaveBeenCalled();
    expect(mocks.tasks.delete).not.toHaveBeenCalled();
  });
  it("rechecks ownership and active builder status before PUT", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "project" }]).mockResolvedValueOnce([]);
    await expect(storeProjectMedia({ ...input, data: Buffer.alloc(100) })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(mocks.put).not.toHaveBeenCalled();
    mocks.profile.findUnique.mockResolvedValueOnce({ status: "ACTIVE", usedStorageBytes: 0n, reservedStorageBytes: 0n, maxStorageBytes: 10_000_000n })
      .mockResolvedValueOnce({ status: "SUSPENDED" });
    await expect(storeProjectMedia({ ...input, data: Buffer.alloc(100) })).rejects.toMatchObject({ code: "BUILDER_REQUIRED" });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.tasks.delete).not.toHaveBeenCalled();
  });
  it("persists exact reservation and cleanup before any PUT", async () => {
    const media = await reserveMediaQuota(input);
    expect(mocks.queryRaw).toHaveBeenCalled();
    expect(mocks.profile.update).toHaveBeenCalledWith({ where: { userId: "owner" }, data: { reservedStorageBytes: { increment: 100n } } });
    expect(mocks.tasks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ resourceType: "ProjectMedia", resourceId: media.id, storageKey: media.storageKey }) });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("counts APK reservations and retained replacement bytes against shared capacity", async () => {
    mocks.profile.findUnique.mockResolvedValue({ status: "ACTIVE", usedStorageBytes: 500n, reservedStorageBytes: 450n, maxStorageBytes: 1000n });
    await expect(reserveMediaQuota(input)).rejects.toMatchObject({ code: "STORAGE_QUOTA_EXCEEDED" });
    expect(mocks.media.create).not.toHaveBeenCalled();
    mocks.profile.findUnique.mockResolvedValue({ status: "ACTIVE", usedStorageBytes: 0n, reservedStorageBytes: 0n, maxStorageBytes: 10_000_000n });
    mocks.media.findMany.mockResolvedValue([{ fileSizeBytes: 8n * 1024n * 1024n, status: "DELETING" }]);
    await expect(reserveMediaQuota(input)).rejects.toMatchObject({ code: "PROJECT_MEDIA_QUOTA_EXCEEDED" });
  });
  it("bounds screenshots and prevents duplicate pending slots", async () => {
    mocks.media.findMany.mockResolvedValue([0, 1, 2, 3, 4].map((position) => ({ position, kind: "SCREENSHOT", status: "READY", fileSizeBytes: 1n })));
    await expect(reserveMediaQuota({ ...input, kind: "SCREENSHOT" })).rejects.toMatchObject({ code: "MEDIA_SLOT_LIMIT" });
    mocks.media.findMany.mockResolvedValue([{ position: 0, kind: "ICON", status: "PENDING", fileSizeBytes: 1n }]);
    await expect(reserveMediaQuota(input)).rejects.toMatchObject({ code: "MEDIA_UPLOAD_PENDING" });
  });
  it("keeps the original and reservation tracked when PUT or DB finalization fails", async () => {
    mocks.put.mockRejectedValueOnce(new Error("ambiguous transport failure"));
    await expect(storeProjectMedia({ ...input, data: Buffer.alloc(100) })).rejects.toThrow("ambiguous");
    expect(mocks.tasks.create).toHaveBeenCalledOnce(); expect(mocks.tasks.delete).not.toHaveBeenCalled();
    expect(mocks.media.update).not.toHaveBeenCalled(); expect(mocks.profile.updateMany).not.toHaveBeenCalled();
    mocks.put.mockResolvedValueOnce(undefined); mocks.profile.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(storeProjectMedia({ ...input, data: Buffer.alloc(100) })).rejects.toThrow("accounting mismatch");
    expect(mocks.tasks.delete).not.toHaveBeenCalled();
  });
  it("commits replacement with both objects still charged and the old one queued", async () => {
    const original = { id: "old", projectId: "project", kind: "ICON", position: 0, status: "READY", fileSizeBytes: 50n, storageKey: "old-key" };
    mocks.media.findMany.mockResolvedValue([original]); mocks.media.findUnique.mockResolvedValue(original);
    await storeProjectMedia({ ...input, data: Buffer.alloc(100) });
    expect(mocks.tasks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ storageKey: "old-key", resourceType: "ProjectMedia" }) }));
    expect(mocks.profile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { reservedStorageBytes: { decrement: 100n }, usedStorageBytes: { increment: 100n } } }));
    expect(mocks.media.update).toHaveBeenCalledWith({ where: { id: "old" }, data: { status: "DELETING", deletedAt: expect.any(Date) } });
    expect(mocks.tasks.delete).toHaveBeenCalledOnce();
  });
  it("does not free quota on logical deletion", async () => {
    mocks.media.findFirst.mockResolvedValue({ id: "m", status: "READY", storageKey: "key" });
    mocks.media.count.mockResolvedValue(0);
    await deleteProjectMedia("owner", "project", "m");
    expect(mocks.tasks.upsert).toHaveBeenCalledOnce(); expect(mocks.profile.updateMany).not.toHaveBeenCalled();
  });
});

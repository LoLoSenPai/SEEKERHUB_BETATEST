import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ head: vi.fn(), query: vi.fn(), media: { findUnique: vi.fn(), updateMany: vi.fn(), delete: vi.fn() }, profile: { updateMany: vi.fn() } }));
vi.mock("@/src/lib/db", () => ({ prisma: {} }));
vi.mock("@/src/lib/storage/s3", () => ({ headObject: mocks.head }));
vi.mock("@/src/features/project-media/service", () => ({ MEDIA_CLEANUP_GRACE_MS: 60 * 60_000, queueMediaDeletion: vi.fn() }));
import { assertMediaDeletionAllowed, assertMediaObjectAbsent, settleMediaDeletion } from "@/src/lib/storage/cleanup-media";

const task = { resourceId: "m", resourceType: "ProjectMedia", storageKey: "key" };
const now = new Date();
const db = { $queryRaw: mocks.query, projectMedia: mocks.media, builderProfile: mocks.profile } as unknown as Prisma.TransactionClient;
beforeEach(() => { vi.resetAllMocks(); mocks.profile.updateMany.mockResolvedValue({ count: 1 }); });

describe("media physical deletion and accounting fences", () => {
  it("refuses visible, in-flight, missing or mismatched resources before S3", async () => {
    for (const row of [null, { storageKey: "other", status: "DELETING" }, { storageKey: "key", status: "READY" }, { storageKey: "key", status: "PENDING", expiresAt: now }]) {
      mocks.media.findUnique.mockResolvedValue(row);
      await expect(assertMediaDeletionAllowed(db, task, now)).rejects.toThrow();
    }
    expect(mocks.head).not.toHaveBeenCalled(); expect(mocks.profile.updateMany).not.toHaveBeenCalled();
  });
  it("atomically fences an expired pending row, and refuses a lost writer race", async () => {
    mocks.media.findUnique.mockResolvedValue({ id: "m", storageKey: "key", status: "PENDING", expiresAt: new Date(0) });
    mocks.media.updateMany.mockResolvedValueOnce({ count: 1 });
    await assertMediaDeletionAllowed(db, task, now);
    expect(mocks.media.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "m", status: "PENDING", expiresAt: new Date(0) }, data: { status: "DELETING", deletedAt: now } }));
    mocks.media.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(assertMediaDeletionAllowed(db, task, now)).rejects.toThrow("state changed");
  });
  it("accepts only confirmed 404, not success, 403 or transport ambiguity", async () => {
    mocks.head.mockResolvedValueOnce({ ContentLength: 1 });
    await expect(assertMediaObjectAbsent("key")).rejects.toThrow("still present");
    mocks.head.mockRejectedValueOnce({ $metadata: { httpStatusCode: 403 } });
    await expect(assertMediaObjectAbsent("key")).rejects.toEqual({ $metadata: { httpStatusCode: 403 } });
    mocks.head.mockRejectedValueOnce(new Error("offline"));
    await expect(assertMediaObjectAbsent("key")).rejects.toThrow("offline");
    mocks.head.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    await expect(assertMediaObjectAbsent("key")).resolves.toBeUndefined();
    expect(mocks.profile.updateMany).not.toHaveBeenCalled();
  });
  it.each([true, false])("settles only the exact %s committed/reserved bytes once", async (ready) => {
    mocks.media.findUnique.mockResolvedValueOnce({ id: "m", storageKey: "key", status: "DELETING", readyAt: ready ? now : null, fileSizeBytes: 123n, project: { ownerId: "owner" } });
    await settleMediaDeletion(db, task);
    const field = ready ? "usedStorageBytes" : "reservedStorageBytes";
    expect(mocks.profile.updateMany).toHaveBeenCalledWith({ where: { userId: "owner", [field]: { gte: 123n } }, data: { [field]: { decrement: 123n } } });
    mocks.media.findUnique.mockResolvedValueOnce(null);
    await settleMediaDeletion(db, task);
    expect(mocks.profile.updateMany).toHaveBeenCalledOnce(); expect(mocks.media.delete).toHaveBeenCalledOnce();
  });
  it("retains the durable row when accounting fails so the surrounding completion can roll back", async () => {
    mocks.media.findUnique.mockResolvedValue({ id: "m", storageKey: "key", status: "DELETING", readyAt: now, fileSizeBytes: 123n, project: { ownerId: "owner" } });
    mocks.profile.updateMany.mockResolvedValue({ count: 0 });
    await expect(settleMediaDeletion(db, task)).rejects.toThrow("accounting mismatch");
    expect(mocks.media.delete).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: { findUnique: vi.fn(), update: vi.fn() },
  upload: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
  release: { count: vi.fn() }, task: { upsert: vi.fn() }, transaction: vi.fn(),
}));
vi.mock("@/src/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
import { reserveUploadQuota, releaseUploadReservation } from "@/src/lib/quota";

const input = {
  userId: "builder", projectId: "project", bytes: 450 * 1024 * 1024,
  storageKey: "projects/project/release-upload-sessions/stage/release.apk",
  fileName: "fixture.apk", contentType: "application/vnd.android.package-archive", draft: {},
  expiresAt: new Date(Date.now() + 15 * 60_000),
};
const tx = { builderProfile: mocks.profile, releaseUploadSession: mocks.upload, release: mocks.release, storageDeletionTask: mocks.task };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (action) => action(tx));
  mocks.profile.findUnique.mockResolvedValue({ status: "ACTIVE", maxApkBytes: 500n * 1024n * 1024n,
    usedStorageBytes: 0n, reservedStorageBytes: 0n, maxStorageBytes: 1000n * 1024n * 1024n, maxStoredReleases: 5 });
  mocks.release.count.mockResolvedValue(0);
  mocks.upload.count.mockResolvedValue(0);
  mocks.upload.create.mockImplementation(async ({ data }) => ({ ...data, id: "session", completedAt: null }));
});

describe("APK staging and final reservation", () => {
  it("rejects 450 MiB on a 500 MiB storage quota before any session or presign can be created", async () => {
    mocks.profile.findUnique.mockResolvedValue({ status: "ACTIVE", maxApkBytes: 500n * 1024n * 1024n,
      usedStorageBytes: 0n, reservedStorageBytes: 0n, maxStorageBytes: 500n * 1024n * 1024n, maxStoredReleases: 5 });
    await expect(reserveUploadQuota(input)).rejects.toMatchObject({ status: 413, code: "STORAGE_QUOTA_EXCEEDED", message: expect.stringContaining("temporary capacity for two APK copies") });
    expect(mocks.upload.create).not.toHaveBeenCalled();
    expect(mocks.profile.update).not.toHaveBeenCalled();
    expect(mocks.task.upsert).not.toHaveBeenCalled();
  });
  it("reserves both physical copies and persists delayed cleanup before returning the session", async () => {
    const upload = await reserveUploadQuota(input);
    expect(upload.expectedSize).toBe(BigInt(input.bytes));
    expect(upload.reservedBytes).toBe(BigInt(input.bytes) * 2n);
    expect(mocks.profile.update).toHaveBeenCalledWith({ where: { userId: "builder" }, data: { reservedStorageBytes: { increment: BigInt(input.bytes) * 2n } } });
    expect(mocks.task.upsert).toHaveBeenCalledTimes(2);
    for (const call of mocks.task.upsert.mock.calls) {
      expect(call[0].create.scheduledFor).toEqual(new Date(input.expiresAt.getTime() + 60 * 60_000));
    }
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("does not release physical quota early when an uncompleted upload is cancelled", async () => {
    mocks.upload.findUnique.mockResolvedValue({ ...input, id: "session", completedAt: null, reservationReleasedAt: null });
    await releaseUploadReservation("session");
    expect(mocks.profile.update).not.toHaveBeenCalled();
    expect(mocks.task.upsert).toHaveBeenCalledTimes(2);
  });
  it("keeps completed staging collectible without scheduling deletion of the referenced final asset", async () => {
    mocks.upload.findUnique.mockResolvedValue({ ...input, id: "session", completedAt: new Date(), reservationReleasedAt: null });
    await releaseUploadReservation("session");
    expect(mocks.profile.update).not.toHaveBeenCalled();
    expect(mocks.task.upsert).toHaveBeenCalledOnce();
    expect(mocks.task.upsert.mock.calls[0][0].create.resourceType).toBe("UploadStaging");
  });
  it("does not reset already-released cleanup tasks", async () => {
    mocks.upload.findUnique.mockResolvedValue({ ...input, id: "session", completedAt: new Date(), reservationReleasedAt: new Date() });
    await releaseUploadReservation("session");
    expect(mocks.task.upsert).not.toHaveBeenCalled();
  });
});

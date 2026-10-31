import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  deleteObject: vi.fn(),
  revalidate: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
  task: { findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  upload: { findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  asset: { findUnique: vi.fn() },
  profile: { updateMany: vi.fn(), update: vi.fn() },
  release: { findUnique: vi.fn(), delete: vi.fn() },
  audit: { create: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/src/lib/session", () => ({ requireAdminSession: mocks.admin }));
vi.mock("@/src/lib/storage/s3", () => ({ deleteObject: mocks.deleteObject }));
vi.mock("@/src/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    releaseUploadSession: mocks.upload,
    buildAsset: mocks.asset,
    storageDeletionTask: mocks.task,
  },
}));
import { purgeStorageTaskAction } from "@/src/features/admin/actions";
import { inspectedApkKey } from "@/src/lib/quota";

const tx = {
  storageDeletionTask: mocks.task,
  releaseUploadSession: mocks.upload,
  buildAsset: mocks.asset,
  builderProfile: mocks.profile,
  release: mocks.release,
  auditLog: mocks.audit,
  $queryRaw: mocks.lock,
};
const old = new Date(Date.now() - 2 * 60 * 60_000);
let task: {
  id: string;
  resourceId: string;
  resourceType: string;
  storageKey: string;
  status: string;
  attempts: number;
  updatedAt: Date;
  completedAt: Date | null;
};
let upload: {
  id: string;
  projectId: string;
  userId: string;
  storageKey: string;
  expiresAt: Date;
  finalizingAt: Date | null;
  completedAt: Date | null;
  reservationReleasedAt: Date | null;
  reservedBytes: bigint;
};
function form(confirmation = "PURGE") {
  const data = new FormData();
  data.set("taskId", "task");
  data.set("confirmation", confirmation);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  task = {
    id: "task",
    resourceId: "upload",
    resourceType: "UploadStaging",
    storageKey: "staging.apk",
    status: "PENDING",
    attempts: 0,
    updatedAt: old,
    completedAt: null,
  };
  upload = {
    id: "upload",
    projectId: "project",
    userId: "builder",
    storageKey: "staging.apk",
    expiresAt: old,
    finalizingAt: null,
    completedAt: new Date(),
    reservationReleasedAt: null,
    reservedBytes: 100n,
  };
  mocks.admin.mockResolvedValue({ user: { id: "admin" } });
  mocks.transaction.mockImplementation(async (action) => action(tx));
  mocks.task.findUnique.mockImplementation(async () => ({ ...task }));
  mocks.upload.findUnique.mockImplementation(async () => ({ ...upload }));
  mocks.task.updateMany.mockResolvedValue({ count: 1 });
  mocks.task.count.mockResolvedValue(0);
  mocks.upload.updateMany.mockResolvedValue({ count: 1 });
  mocks.profile.updateMany.mockResolvedValue({ count: 1 });
  mocks.asset.findUnique.mockResolvedValue(null);
  mocks.deleteObject.mockResolvedValue(undefined);
});

describe("admin storage purge uses cleanup invariants", () => {
  it("requires administrator authorization and explicit PURGE", async () => {
    await expect(purgeStorageTaskAction(form("DELETE"))).rejects.toThrow(
      "Type PURGE",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.admin.mockRejectedValue(new Error("Unauthorized"));
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "Unauthorized",
    );
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it.each(["UploadStaging", "UploadFinal", "UploadSession"])(
    "cannot bypass the replay window for %s",
    async (kind) => {
      task.resourceType = kind;
      upload.completedAt = null;
      if (kind === "UploadFinal")
        task.storageKey = inspectedApkKey(upload.projectId, upload.id);
      upload.expiresAt = new Date(Date.now() - 10 * 60_000);
      await expect(purgeStorageTaskAction(form())).rejects.toThrow(
        "window has not expired",
      );
      expect(mocks.deleteObject).not.toHaveBeenCalled();
      expect(mocks.profile.updateMany).not.toHaveBeenCalled();
    },
  );

  it("rejects an active finalization lease even after presign grace", async () => {
    upload.finalizingAt = new Date();
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "window has not expired",
    );
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("rejects an unknown resource type and an upload without its session", async () => {
    task.resourceType = "Unknown";
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "Unknown storage",
    );
    task.resourceType = "UploadStaging";
    mocks.upload.findUnique.mockResolvedValue(null);
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "session is missing",
    );
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("rejects referenced orphan-final tasks and mismatched keys before S3", async () => {
    task.resourceType = "UploadFinal";
    upload.completedAt = null;
    task.storageKey = inspectedApkKey(upload.projectId, upload.id);
    mocks.asset.findUnique.mockResolvedValue({ id: "asset" });
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "referenced by a build asset",
    );
    mocks.asset.findUnique.mockResolvedValue(null);
    task.storageKey = "other.apk";
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "mismatched upload key",
    );
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("rejects a completed final even if no asset is found", async () => {
    task.resourceType = "UploadFinal";
    task.storageKey = inspectedApkKey(upload.projectId, upload.id);
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "completed final",
    );
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("rechecks the shared guard after the claim and before deleting", async () => {
    mocks.asset.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "new-asset" });
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "referenced by a build asset",
    );
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it("deletes completed staging, then locks and settles its retained quota", async () => {
    await purgeStorageTaskAction(form());
    expect(mocks.deleteObject).toHaveBeenCalledWith("staging.apk");
    expect(mocks.deleteObject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.lock.mock.invocationCallOrder[0],
    );
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.profile.updateMany.mock.invocationCallOrder[0],
    );
    expect(mocks.profile.updateMany).toHaveBeenCalledWith({
      where: { userId: "builder", reservedStorageBytes: { gte: 100n } },
      data: { reservedStorageBytes: { decrement: 100n } },
    });
    expect(mocks.upload.deleteMany).not.toHaveBeenCalled();
    expect(mocks.audit.create).toHaveBeenCalledOnce();
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin");
  });

  it("keeps the reservation and session until all object tasks are complete", async () => {
    upload.completedAt = null;
    mocks.task.count.mockResolvedValue(1);
    await purgeStorageTaskAction(form());
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.profile.updateMany).not.toHaveBeenCalled();
    expect(mocks.upload.deleteMany).not.toHaveBeenCalled();
  });

  it("settles a legacy UploadSession instead of discarding its reserved bytes", async () => {
    task.resourceType = "UploadSession";
    upload.completedAt = null;
    upload.reservedBytes = 200n;
    await purgeStorageTaskAction(form());
    expect(
      mocks.profile.updateMany.mock.calls[0][0].data.reservedStorageBytes
        .decrement,
    ).toBe(200n);
    expect(mocks.upload.deleteMany).toHaveBeenCalledWith({
      where: { id: "upload", completedAt: null },
    });
  });

  it("does not double-decrement an already released legacy reservation", async () => {
    task.resourceType = "UploadSession";
    upload.completedAt = null;
    upload.reservationReleasedAt = old;
    await purgeStorageTaskAction(form());
    expect(mocks.profile.updateMany).not.toHaveBeenCalled();
    expect(mocks.upload.deleteMany).toHaveBeenCalledOnce();
  });

  it("keeps quota on physical deletion failure and fences the failure write", async () => {
    mocks.deleteObject.mockRejectedValue(new Error("storage unavailable"));
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "storage unavailable",
    );
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.profile.updateMany).not.toHaveBeenCalled();
    expect(mocks.task.updateMany.mock.lastCall?.[0]).toMatchObject({
      where: {
        status: "PROCESSING",
        attempts: 1,
        updatedAt: expect.any(Date),
        completedAt: null,
      },
      data: { status: "FAILED" },
    });
  });

  it("does not settle a lost task lease or allow an already completed task", async () => {
    mocks.task.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "state changed unexpectedly",
    );
    expect(mocks.profile.updateMany).not.toHaveBeenCalled();
    task.status = "COMPLETED";
    task.completedAt = new Date();
    await expect(purgeStorageTaskAction(form())).rejects.toThrow("unavailable");
    expect(mocks.deleteObject).toHaveBeenCalledOnce();
  });

  it("preserves explicit immediate purge of trashed releases before their scheduled date", async () => {
    task.resourceType = "Release";
    mocks.release.findUnique.mockResolvedValue({
      id: "release",
      deletedAt: old,
      purgeAfter: new Date(Date.now() + 86_400_000),
      buildAsset: { storageKey: task.storageKey, fileSizeBytes: 100n },
      project: { ownerId: "builder" },
    });
    await purgeStorageTaskAction(form());
    expect(mocks.deleteObject).toHaveBeenCalledOnce();
    expect(mocks.profile.update).toHaveBeenCalledWith({
      where: { userId: "builder" },
      data: { usedStorageBytes: { decrement: 100n } },
    });
    expect(mocks.release.delete).toHaveBeenCalledWith({
      where: { id: "release" },
    });
  });

  it("refuses active releases and inconsistent release storage keys", async () => {
    task.resourceType = "Release";
    mocks.release.findUnique.mockResolvedValue({ deletedAt: null });
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "Only trashed releases",
    );
    mocks.release.findUnique.mockResolvedValue({
      deletedAt: old,
      buildAsset: { storageKey: "another.apk" },
    });
    await expect(purgeStorageTaskAction(form())).rejects.toThrow(
      "key mismatch",
    );
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });
});

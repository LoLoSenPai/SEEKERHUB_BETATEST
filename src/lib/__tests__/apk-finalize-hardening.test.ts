import { readFile, stat, writeFile } from "node:fs/promises";
import { describe, beforeEach, expect, it, vi } from "vitest";
import { apkFixture } from "@/tests/fixtures/apk";

const mocks = vi.hoisted(() => ({
  upload: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  project: { findFirst: vi.fn(), update: vi.fn() },
  profile: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  asset: { create: vi.fn(), findUnique: vi.fn() },
  release: { create: vi.fn() },
  task: { upsert: vi.fn(), deleteMany: vi.fn() },
  policy: { create: vi.fn() }, group: { findFirst: vi.fn() }, audit: { create: vi.fn() },
  download: vi.fn(), head: vi.fn(), put: vi.fn(), auth: vi.fn(), inspect: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/src/lib/db", () => {
  const db = {
    releaseUploadSession: mocks.upload, appProject: mocks.project, builderProfile: mocks.profile,
    buildAsset: mocks.asset, release: mocks.release, storageDeletionTask: mocks.task,
    accessPolicy: mocks.policy, testerGroup: mocks.group, auditLog: mocks.audit,
  };
  mocks.transaction.mockImplementation((action: (tx: typeof db) => unknown) => action(db));
  return { prisma: { ...db, $transaction: mocks.transaction } };
});
vi.mock("@/src/lib/session", () => ({ requireBuilderApiSession: mocks.auth }));
vi.mock("@/src/lib/apk", () => ({ inspectApkFile: mocks.inspect }));
vi.mock("@/src/lib/storage/s3", () => ({
  downloadObjectToFile: mocks.download, headObject: mocks.head, uploadInspectedApk: mocks.put,
  getBucketName: () => "local-tests",
}));
vi.mock("@/src/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { POST } from "@/app/api/uploads/releases/[sessionId]/finalize/route";

const bytes = apkFixture();
const expectedSize = BigInt(bytes.length);
const finalKey = "projects/project/inspected-apks/upload/release.apk";
const metadata = {
  packageName: "com.example.beta", versionName: "1.2.3", versionCode: 42, minSdk: null, targetSdk: null,
  fileSizeBytes: expectedSize, sha256Checksum: "ab".repeat(32), hasApkSignature: true,
  detectedMimeType: "application/vnd.android.package-archive",
};
let upload: Record<string, unknown>;
let localPath: string;
const invoke = () => POST(new Request("http://localhost/api/uploads/releases/upload/finalize", { method: "POST" }), { params: Promise.resolve({ sessionId: "upload" }) });

beforeEach(() => {
  for (const group of Object.values(mocks)) {
    if (typeof group === "function") {
      if (group !== mocks.transaction) group.mockReset();
      else group.mockClear();
    } else for (const fn of Object.values(group)) fn.mockReset();
  }
  localPath = "";
  upload = {
    id: "upload", projectId: "project", userId: "builder", storageKey: "projects/project/release-upload-sessions/staging/build.apk",
    originalFileName: "build.apk", expectedSize, reservedBytes: expectedSize, completedAt: null,
    reservationReleasedAt: null, finalizingAt: null, expiresAt: new Date(Date.now() + 15 * 60_000),
    project: { deletedAt: null },
    draftJson: { projectId: "cm12345678901234567890123", versionName: "placeholder", versionCode: 1, changelog: "Build notes", accessPolicy: {} },
  };
  mocks.auth.mockResolvedValue({ user: { id: "builder" } });
  mocks.upload.findFirst.mockImplementation(async () => ({ ...upload }));
  mocks.upload.findUnique.mockImplementation(async () => ({ ...upload }));
  mocks.upload.findUniqueOrThrow.mockImplementation(async () => ({ ...upload }));
  mocks.upload.updateMany.mockImplementation(async ({ data }) => { Object.assign(upload, data); return { count: 1 }; });
  mocks.upload.update.mockImplementation(async ({ data }) => Object.assign(upload, data));
  mocks.profile.findUnique.mockResolvedValue({ status: "ACTIVE", usedStorageBytes: 0n, reservedStorageBytes: expectedSize, maxStorageBytes: expectedSize * 10n });
  mocks.profile.updateMany.mockResolvedValue({ count: 1 });
  mocks.project.findFirst.mockResolvedValue({ id: "project", androidPackageName: null });
  mocks.release.create.mockResolvedValue({ id: "draft-release" });
  mocks.head.mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
  mocks.download.mockImplementation(async (_key, path, size) => {
    expect(size).toBe(expectedSize); localPath = path; await writeFile(path, bytes, { flag: "wx" });
  });
  mocks.inspect.mockImplementation(async (path) => { expect(await readFile(path)).toEqual(bytes); return metadata; });
  mocks.put.mockImplementation(async ({ filePath }) => { expect(filePath).toBe(localPath); expect(await readFile(filePath)).toEqual(bytes); });
});

describe("APK finalize security contract", () => {
  it("creates a private draft from the exact inspected snapshot, with durable deferred cleanup", async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ releaseId: "draft-release", metadata: { packageName: metadata.packageName, fileSizeBytes: expectedSize.toString() } });
    expect(mocks.release.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "DRAFT" }) });
    expect(mocks.asset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ storageKey: finalKey, sha256Checksum: metadata.sha256Checksum }) });
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ key: finalKey, filePath: localPath }));
    expect(mocks.task.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
      storageKey: upload.storageKey, resourceType: "UploadStaging",
      scheduledFor: new Date((upload.expiresAt as Date).getTime() + 60 * 60_000),
    }) }));
    expect(mocks.task.deleteMany).toHaveBeenCalledWith({ where: { storageKey: finalKey } });
    expect(mocks.profile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { reservedStorageBytes: { increment: expectedSize } } }));
    expect(mocks.profile.update).toHaveBeenCalledWith({ where: { userId: "builder" }, data: {
      usedStorageBytes: { increment: expectedSize }, reservedStorageBytes: { decrement: expectedSize },
    } });
    expect(upload.reservationReleasedAt).toBeNull();
    expect(upload.reservedBytes).toBe(expectedSize);
    expect(mocks.audit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "release.draft_created" }) }));
    await expect(stat(localPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("returns the same release and metadata after a lost final HTTP response without charging twice", async () => {
    upload.completedAt = new Date();
    mocks.asset.findUnique.mockResolvedValue({
      ...metadata, releaseId: "draft-release", release: { ...metadata, createdById: "builder", deletedAt: null,
        project: { androidPackageName: metadata.packageName, deletedAt: null } },
    });
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ releaseId: "draft-release", metadata: { versionCode: 42 } });
    expect(mocks.asset.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { storageKey: finalKey } }));
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.profile.update).not.toHaveBeenCalled();
    expect(mocks.release.create).not.toHaveBeenCalled();
  });
  it("recovers an already-written final object instead of inspecting replayed staging bytes", async () => {
    mocks.head.mockResolvedValue({ ContentLength: bytes.length });
    upload.reservedBytes = expectedSize * 2n;
    expect((await invoke()).status).toBe(200);
    expect(mocks.download).toHaveBeenCalledWith(finalKey, expect.any(String), expectedSize);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.profile.updateMany).not.toHaveBeenCalled();
  });
  it("keeps reservations and orphan cleanup intents on a failed write, and cleans tmp in finally", async () => {
    mocks.put.mockRejectedValue(new Error("storage unavailable"));
    expect((await invoke()).status).toBe(500);
    expect(mocks.release.create).not.toHaveBeenCalled();
    expect(mocks.task.deleteMany).not.toHaveBeenCalled();
    expect(upload.reservedBytes).toBe(expectedSize * 2n);
    expect(upload.reservationReleasedAt).toBeNull();
    expect(upload.finalizingAt).toBeNull();
    await expect(stat(localPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects capacity exhaustion before downloading or writing final bytes", async () => {
    mocks.profile.findUnique.mockResolvedValue({ status: "ACTIVE", usedStorageBytes: 0n, reservedStorageBytes: expectedSize, maxStorageBytes: expectedSize });
    expect((await invoke()).status).toBe(413);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("does not reserve extra capacity after uploading a newly pre-reserved session", async () => {
    upload.reservedBytes = expectedSize * 2n;
    expect((await invoke()).status).toBe(200);
    expect(mocks.profile.findUnique).not.toHaveBeenCalled();
    expect(mocks.profile.updateMany).not.toHaveBeenCalled();
    expect(upload.reservedBytes).toBe(expectedSize);
  });
  it("does not claim or mutate a session owned by another builder", async () => {
    mocks.upload.findFirst.mockResolvedValue(null);
    expect((await invoke()).status).toBe(404);
    expect(mocks.upload.updateMany).not.toHaveBeenCalled();
  });
  it("rejects a lost lease before creating the draft", async () => {
    mocks.upload.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await invoke()).status).toBe(409);
    expect(mocks.release.create).not.toHaveBeenCalled();
    expect(mocks.task.deleteMany).not.toHaveBeenCalled();
    await expect(stat(localPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("retries serialization conflicts before binding the project's first Android package", async () => {
    mocks.project.findFirst.mockRejectedValueOnce({ code: "P2034" });
    expect((await invoke()).status).toBe(200);
    expect(mocks.project.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenLastCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.release.create).toHaveBeenCalledOnce();
    expect(mocks.put).toHaveBeenCalledOnce();
  });
  it("fails closed if a concurrent transaction bound a different package during a serialization retry", async () => {
    mocks.project.findFirst.mockRejectedValueOnce({ code: "P2034" }).mockResolvedValueOnce({ id: "project", androidPackageName: "other.package" });
    expect((await invoke()).status).toBe(409);
    expect(mocks.release.create).not.toHaveBeenCalled();
    expect(mocks.asset.create).not.toHaveBeenCalled();
  });
  it("bounds serialization retries without re-uploading inspected bytes", async () => {
    mocks.project.findFirst.mockRejectedValue({ code: "P2034" });
    expect((await invoke()).status).toBe(500);
    expect(mocks.project.findFirst).toHaveBeenCalledTimes(3);
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.release.create).not.toHaveBeenCalled();
  });
});

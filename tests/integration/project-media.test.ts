import { randomUUID } from "node:crypto";
import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/session", () => ({ requireAdminSession: mocks.admin }));

const enabled = process.env.RUN_INTEGRATION_TESTS === "true";
const run = randomUUID();
const bucket = `media-test-${run}`;
const userIds: string[] = [];
const projectIds: string[] = [];
const keys = new Set<string>();
let prisma: (typeof import("@/src/lib/db"))["prisma"];
let storage: typeof import("@/src/lib/storage/s3");
let service: typeof import("@/src/features/project-media/service");
let cleanup: typeof import("@/src/lib/storage/cleanup-media");
let query: (typeof import("@/src/features/project-media/queries"))["getProjectMedia"];
let purge: (typeof import("@/src/features/admin/actions"))["purgeStorageTaskAction"];
let image: { data: Buffer; width: number; height: number };
let createdBucket = false;

async function fixture(maxStorageBytes = 10_000_000n) {
  const user = await prisma.user.create({ data: {
    name: "Media integration", email: `media-${randomUUID()}@example.com`, emailVerified: true,
    builderProfile: { create: { maxStorageBytes, maxApkBytes: 1_000_000n, maxStoredReleases: 10 } },
  } });
  userIds.push(user.id);
  const project = await prisma.appProject.create({ data: { ownerId: user.id, name: "Media test", slug: `media-${randomUUID()}` } });
  projectIds.push(project.id);
  mocks.admin.mockResolvedValue({ user: { id: user.id } });
  return { userId: user.id, projectId: project.id };
}

async function profile(userId: string) { return prisma.builderProfile.findUniqueOrThrow({ where: { userId } }); }
async function media(projectId: string) {
  const rows = await prisma.projectMedia.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  for (const row of rows) keys.add(row.storageKey);
  return rows;
}
async function purgeMedia(storageKey: string) {
  const task = await prisma.storageDeletionTask.findUniqueOrThrow({ where: { storageKey } });
  const form = new FormData(); form.set("taskId", task.id); form.set("confirmation", "PURGE");
  await purge(form);
  return form;
}

describe.skipIf(!enabled)("project media local PostgreSQL + private S3 lifecycle", () => {
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
    const endpoint = new URL(process.env.S3_ENDPOINT ?? "http://invalid");
    const local = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    if (!local(database.hostname) || !database.pathname.toLowerCase().includes("test") || !local(endpoint.hostname)) throw new Error("Media integration requires a disposable loopback test database and S3.");
    vi.stubEnv("S3_BUCKET", bucket);
    ({ prisma } = await import("@/src/lib/db"));
    storage = await import("@/src/lib/storage/s3");
    service = await import("@/src/features/project-media/service");
    cleanup = await import("@/src/lib/storage/cleanup-media");
    ({ getProjectMedia: query } = await import("@/src/features/project-media/queries"));
    ({ purgeStorageTaskAction: purge } = await import("@/src/features/admin/actions"));
    expect(storage.getBucketName()).toBe(bucket);
    await storage.storageClient.send(new CreateBucketCommand({ Bucket: bucket })); createdBucket = true;
    const { normalizeProjectMedia } = await import("@/src/features/project-media/normalize");
    const input = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#447766" } }).png().toBuffer();
    image = await normalizeProjectMedia(input, "ICON");
  });
  afterAll(async () => {
    try {
      if (projectIds.length) {
        for (const row of await prisma.projectMedia.findMany({ where: { projectId: { in: projectIds } } })) keys.add(row.storageKey);
        for (const key of keys) await storage.deleteObject(key);
        await prisma.storageDeletionTask.deleteMany({ where: { OR: projectIds.map((id) => ({ storageKey: { startsWith: `projects/${id}/` } })) } });
        await prisma.projectMedia.deleteMany({ where: { projectId: { in: projectIds } } });
        await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      if (createdBucket) await storage.storageClient.send(new DeleteBucketCommand({ Bucket: bucket }));
    } finally { vi.restoreAllMocks(); vi.unstubAllEnvs(); }
  });

  it("stores only normalized WebP and emits a private inline DTO", async () => {
    const owner = await fixture();
    await service.storeProjectMedia({ ...owner, kind: "ICON", ...image });
    const [row] = await media(owner.projectId);
    expect(row.status).toBe("READY"); expect(row.readyAt).toBeInstanceOf(Date);
    expect((await storage.headObject(row.storageKey)).ContentType).toBe("image/webp");
    expect(await profile(owner.userId)).toMatchObject({ usedStorageBytes: BigInt(image.data.length), reservedStorageBytes: 0n });
    const [item] = await query(owner.projectId);
    expect(Object.keys(item).sort()).toEqual(["height", "id", "kind", "position", "url", "width"]);
    const url = new URL(item.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("response-content-disposition")).toBe("inline");
    const response = await fetch(url); expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(image.data);
    const unsigned = new URL(url); unsigned.search = "";
    expect((await fetch(unsigned)).status).toBe(403);
  });

  it("keeps replacement bytes charged through failed physical deletion, then settles once", async () => {
    const owner = await fixture();
    await service.storeProjectMedia({ ...owner, kind: "ICON", ...image });
    const [old] = await media(owner.projectId);
    await service.storeProjectMedia({ ...owner, kind: "ICON", ...image });
    const rows = await media(owner.projectId);
    expect(rows.filter((row) => row.status === "READY")).toHaveLength(1);
    expect(await profile(owner.userId)).toMatchObject({ usedStorageBytes: 2n * BigInt(image.data.length), reservedStorageBytes: 0n });
    const originalSend = storage.storageClient.send.bind(storage.storageClient);
    const spy = vi.spyOn(storage.storageClient, "send").mockImplementation((async (command: unknown) => {
      if (command instanceof DeleteObjectCommand) throw new Error("simulated delete unavailable");
      return originalSend(command as never);
    }) as never);
    try { await expect(purgeMedia(old.storageKey)).rejects.toThrow("delete unavailable"); } finally { spy.mockRestore(); }
    expect((await storage.headObject(old.storageKey)).ContentLength).toBe(image.data.length);
    expect((await profile(owner.userId)).usedStorageBytes).toBe(2n * BigInt(image.data.length));
    const form = await purgeMedia(old.storageKey);
    await expect(storage.headObject(old.storageKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect((await profile(owner.userId)).usedStorageBytes).toBe(BigInt(image.data.length));
    await expect(purge(form)).rejects.toThrow("unavailable");
    expect((await profile(owner.userId)).usedStorageBytes).toBe(BigInt(image.data.length));
  });

  it("tracks an acknowledged-by-storage but failed PUT transaction until safe pending cleanup", async () => {
    const owner = await fixture();
    const originalSend = storage.storageClient.send.bind(storage.storageClient);
    const spy = vi.spyOn(storage.storageClient, "send").mockImplementation((async (command: unknown) => {
      const result = await originalSend(command as never);
      if (command instanceof PutObjectCommand) { keys.add(command.input.Key!); throw new Error("lost PUT acknowledgement"); }
      return result;
    }) as never);
    try { await expect(service.storeProjectMedia({ ...owner, kind: "ICON", ...image })).rejects.toThrow("lost PUT"); } finally { spy.mockRestore(); }
    const [row] = await media(owner.projectId);
    expect(row.status).toBe("PENDING"); expect(await query(owner.projectId)).toEqual([]);
    expect(await profile(owner.userId)).toMatchObject({ usedStorageBytes: 0n, reservedStorageBytes: BigInt(image.data.length) });
    expect((await storage.headObject(row.storageKey)).ContentLength).toBe(image.data.length);
    await expect(purgeMedia(row.storageKey)).rejects.toThrow("safety window");
    await prisma.projectMedia.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 2 * 60 * 60_000) } });
    await purgeMedia(row.storageKey);
    expect(await profile(owner.userId)).toMatchObject({ usedStorageBytes: 0n, reservedStorageBytes: 0n });
    expect(await media(owner.projectId)).toEqual([]);
  });

  it("serializes concurrent screenshot slot reservations and respects shared APK capacity", async () => {
    const owner = await fixture();
    const input = { ...owner, kind: "SCREENSHOT" as const, bytes: 100, width: 100, height: 100 };
    const attempts = await Promise.allSettled(Array.from({ length: 9 }, () => service.reserveMediaQuota(input)));
    const successful = attempts.filter((result) => result.status === "fulfilled").length;
    expect(successful).toBeGreaterThan(0); expect(successful).toBeLessThanOrEqual(5);
    let rows = await media(owner.projectId);
    expect(rows).toHaveLength(successful); expect(new Set(rows.map((row) => row.position)).size).toBe(successful);
    expect((await profile(owner.userId)).reservedStorageBytes).toBe(BigInt(successful * 100));
    while (rows.length < 5) { await service.reserveMediaQuota(input); rows = await media(owner.projectId); }
    await expect(service.reserveMediaQuota(input)).rejects.toMatchObject({ code: "MEDIA_SLOT_LIMIT" });

    const limited = await fixture(1000n);
    const { reserveUploadQuota } = await import("@/src/lib/quota");
    const outcomes = await Promise.allSettled([
      service.reserveMediaQuota({ ...limited, kind: "ICON", bytes: 500, width: 512, height: 512 }),
      reserveUploadQuota({ ...limited, bytes: 300, storageKey: `projects/${limited.projectId}/staging/test.apk`, fileName: "test.apk", contentType: "application/vnd.android.package-archive", draft: {}, expiresAt: new Date(Date.now() + 60_000) }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await profile(limited.userId)).reservedStorageBytes).toBeLessThanOrEqual(1000n);
  });

  it("hides soft-deleted projects immediately and retains the project until physical media cleanup", async () => {
    const owner = await fixture();
    await service.storeProjectMedia({ ...owner, kind: "ICON", ...image });
    const [row] = await media(owner.projectId);
    await prisma.appProject.update({ where: { id: owner.projectId }, data: { deletedAt: new Date(), purgeAfter: new Date(Date.now() + 86_400_000) } });
    expect(await query(owner.projectId)).toEqual([]);
    expect(await cleanup.queueExpiredProjectMedia(new Date(), Date.now() + 5000)).toBe(0);
    // Restoration before retention expiry does not lose images or change quota.
    await prisma.appProject.update({ where: { id: owner.projectId }, data: { deletedAt: null, purgeAfter: null } });
    expect(await query(owner.projectId)).toHaveLength(1);
    await prisma.appProject.update({ where: { id: owner.projectId }, data: { deletedAt: new Date(), purgeAfter: new Date(0) } });
    await cleanup.queueExpiredProjectMedia(new Date(), Date.now() + 5000);
    const { pruneRetention } = await import("@/src/lib/storage/cleanup-retention");
    await pruneRetention(new Date());
    expect(await prisma.appProject.findUnique({ where: { id: owner.projectId } })).not.toBeNull();
    await purgeMedia(row.storageKey);
    expect((await profile(owner.userId)).usedStorageBytes).toBe(0n);
    await pruneRetention(new Date());
    expect(await prisma.appProject.findUnique({ where: { id: owner.projectId } })).toBeNull();
  });
});

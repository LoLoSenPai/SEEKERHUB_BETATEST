import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/session", () => ({ requireAdminSession: mocks.admin }));

const enabled = process.env.RUN_INTEGRATION_TESTS === "true";
const run = randomUUID();
const bucket = `admin-purge-test-${run}`;
const keys: string[] = [];
const sessionIds: string[] = [];
const taskIds: string[] = [];
const old = new Date(Date.now() - 2 * 60 * 60_000);
let prisma: (typeof import("@/src/lib/db"))["prisma"];
let storage: typeof import("@/src/lib/storage/s3");
let purge: (typeof import("@/src/features/admin/actions"))["purgeStorageTaskAction"];
let userId: string;
let projectId: string;
let bucketCreated = false;
let version = 0;

function form(taskId: string) {
  const data = new FormData();
  data.set("taskId", taskId);
  data.set("confirmation", "PURGE");
  return data;
}

async function put(key: string) {
  keys.push(key);
  await storage.storageClient.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.alloc(100) }),
  );
}

async function session(
  options: {
    completed?: boolean;
    released?: boolean;
    bytes?: bigint;
    expiresAt?: Date;
  } = {},
) {
  const bytes = options.bytes ?? 200n;
  const upload = await prisma.releaseUploadSession.create({
    data: {
      userId,
      projectId,
      storageKey: `admin-test/${run}/${randomUUID()}.apk`,
      originalFileName: "test.apk",
      contentType: "application/vnd.android.package-archive",
      expectedSize: 100n,
      reservedBytes: bytes,
      draftJson: {},
      expiresAt: options.expiresAt ?? old,
      completedAt: options.completed ? new Date() : null,
      reservationReleasedAt: options.released ? old : null,
    },
  });
  sessionIds.push(upload.id);
  if (!options.released)
    await prisma.builderProfile.update({
      where: { userId },
      data: { reservedStorageBytes: { increment: bytes } },
    });
  await put(upload.storageKey);
  return upload;
}

async function task(
  storageKey: string,
  resourceType: string,
  resourceId: string,
) {
  const row = await prisma.storageDeletionTask.create({
    data: { storageKey, resourceType, resourceId, scheduledFor: old },
  });
  taskIds.push(row.id);
  return row;
}

async function reserved() {
  return (await prisma.builderProfile.findUniqueOrThrow({ where: { userId } }))
    .reservedStorageBytes;
}

describe.skipIf(!enabled)(
  "admin purge local PostgreSQL and S3 boundary",
  () => {
    beforeAll(async () => {
      const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
      const endpoint = new URL(process.env.S3_ENDPOINT ?? "http://invalid");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
        !database.pathname.toLowerCase().includes("test") ||
        !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
      ) {
        throw new Error(
          "Admin purge tests require a disposable local test database and loopback S3.",
        );
      }
      vi.stubEnv("S3_BUCKET", bucket);
      ({ prisma } = await import("@/src/lib/db"));
      storage = await import("@/src/lib/storage/s3");
      ({ purgeStorageTaskAction: purge } = await import(
        "@/src/features/admin/actions"
      ));
      expect(storage.getBucketName()).toBe(bucket);
      await storage.storageClient.send(
        new CreateBucketCommand({ Bucket: bucket }),
      );
      bucketCreated = true;
      const user = await prisma.user.create({
        data: {
          name: "Admin purge test",
          email: `${run}@example.com`,
          builderProfile: { create: { maxStorageBytes: 100_000n } },
        },
      });
      userId = user.id;
      mocks.admin.mockResolvedValue({ user: { id: userId } });
      const project = await prisma.appProject.create({
        data: {
          ownerId: userId,
          name: "Admin purge test",
          slug: `admin-${run}`,
        },
      });
      projectId = project.id;
    });

    afterAll(async () => {
      try {
        if (userId) {
          await prisma.storageDeletionTask.deleteMany({
            where: {
              OR: [{ id: { in: taskIds } }, { resourceId: { in: sessionIds } }],
            },
          });
          await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
          await prisma.user.delete({ where: { id: userId } });
        }
        if (bucketCreated) {
          for (const key of keys) await storage.deleteObject(key);
          await storage.storageClient.send(
            new DeleteBucketCommand({ Bucket: bucket }),
          );
        }
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("deletes completed staging then releases its exact reservation once", async () => {
      const upload = await session({ completed: true, bytes: 100n });
      const deletion = await task(
        upload.storageKey,
        "UploadStaging",
        upload.id,
      );
      const before = await reserved();
      await purge(form(deletion.id));
      await expect(storage.headObject(upload.storageKey)).rejects.toMatchObject(
        { $metadata: { httpStatusCode: 404 } },
      );
      expect(await reserved()).toBe(before - 100n);
      expect(
        await prisma.releaseUploadSession.findUniqueOrThrow({
          where: { id: upload.id },
        }),
      ).toMatchObject({
        reservedBytes: 0n,
        reservationReleasedAt: expect.any(Date),
      });
      await expect(purge(form(deletion.id))).rejects.toThrow("unavailable");
      expect(await reserved()).toBe(before - 100n);
    });

    it("serializes concurrent staging/final completion and settles two-copy quota once", async () => {
      const upload = await session();
      const { inspectedApkKey } = await import("@/src/lib/quota");
      const finalKey = inspectedApkKey(projectId, upload.id);
      await put(finalKey);
      const staging = await task(upload.storageKey, "UploadStaging", upload.id);
      const final = await task(finalKey, "UploadFinal", upload.id);
      const before = await reserved();
      await Promise.all([purge(form(staging.id)), purge(form(final.id))]);
      expect(await reserved()).toBe(before - 200n);
      expect(
        await prisma.releaseUploadSession.findUnique({
          where: { id: upload.id },
        }),
      ).toBeNull();
      expect(
        await prisma.storageDeletionTask.count({
          where: { id: { in: [staging.id, final.id] }, status: "COMPLETED" },
        }),
      ).toBe(2);
      await expect(storage.headObject(finalKey)).rejects.toMatchObject({
        $metadata: { httpStatusCode: 404 },
      });
    });

    it("settles retained legacy quota without double-decrementing already released legacy rows", async () => {
      for (const released of [false, true]) {
        const upload = await session({ released, bytes: 100n });
        const deletion = await task(
          upload.storageKey,
          "UploadSession",
          upload.id,
        );
        const before = await reserved();
        await purge(form(deletion.id));
        expect(await reserved()).toBe(before - (released ? 0n : 100n));
        expect(
          await prisma.releaseUploadSession.findUnique({
            where: { id: upload.id },
          }),
        ).toBeNull();
      }
    });

    it("retains all reserved bytes after the first physical object until the second is deleted", async () => {
      const upload = await session();
      const { inspectedApkKey } = await import("@/src/lib/quota");
      const finalKey = inspectedApkKey(projectId, upload.id);
      await put(finalKey);
      const staging = await task(upload.storageKey, "UploadStaging", upload.id);
      const final = await task(finalKey, "UploadFinal", upload.id);
      const before = await reserved();
      await purge(form(staging.id));
      expect(await reserved()).toBe(before);
      expect(
        (
          await prisma.releaseUploadSession.findUniqueOrThrow({
            where: { id: upload.id },
          })
        ).reservedBytes,
      ).toBe(200n);
      expect((await storage.headObject(finalKey)).ContentLength).toBe(100);
      await purge(form(final.id));
      expect(await reserved()).toBe(before - 200n);
    });

    it("rolls back task completion on accounting failure and safely retries an already deleted object", async () => {
      const upload = await session({ completed: true, bytes: 100n });
      const deletion = await task(
        upload.storageKey,
        "UploadStaging",
        upload.id,
      );
      const before = await reserved();
      await prisma.builderProfile.update({
        where: { userId },
        data: { reservedStorageBytes: 0n },
      });
      try {
        await expect(purge(form(deletion.id))).rejects.toThrow(
          "accounting mismatch",
        );
        await expect(
          storage.headObject(upload.storageKey),
        ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
        expect(
          await prisma.storageDeletionTask.findUniqueOrThrow({
            where: { id: deletion.id },
          }),
        ).toMatchObject({ status: "FAILED", completedAt: null });
        expect(
          await prisma.releaseUploadSession.findUniqueOrThrow({
            where: { id: upload.id },
          }),
        ).toMatchObject({ reservedBytes: 100n, reservationReleasedAt: null });
        expect(
          await prisma.auditLog.count({ where: { targetId: upload.id } }),
        ).toBe(0);
      } finally {
        await prisma.builderProfile.update({
          where: { userId },
          data: { reservedStorageBytes: before },
        });
      }
      await purge(form(deletion.id));
      expect(await reserved()).toBe(before - 100n);
      expect(
        await prisma.auditLog.count({
          where: { targetId: upload.id, action: "storage.purged_immediately" },
        }),
      ).toBe(1);
    });

    it("keeps an in-flight/replayable upload and its quota intact", async () => {
      const upload = await session({
        expiresAt: new Date(Date.now() - 10 * 60_000),
      });
      const deletion = await task(
        upload.storageKey,
        "UploadStaging",
        upload.id,
      );
      const before = await reserved();
      await expect(purge(form(deletion.id))).rejects.toThrow(
        "window has not expired",
      );
      expect((await storage.headObject(upload.storageKey)).ContentLength).toBe(
        100,
      );
      expect(await reserved()).toBe(before);
      expect(
        (
          await prisma.storageDeletionTask.findUniqueOrThrow({
            where: { id: deletion.id },
          })
        ).status,
      ).toBe("PENDING");
    });

    it("does not delete a final referenced by a build, while allowing explicit immediate release trash purge", async () => {
      const upload = await session();
      const { inspectedApkKey } = await import("@/src/lib/quota");
      const finalKey = inspectedApkKey(projectId, upload.id);
      await put(finalKey);
      const release = await prisma.release.create({
        data: {
          projectId,
          createdById: userId,
          versionName: "test",
          versionCode: ++version,
          changelog: "test",
          deletedAt: new Date(),
          purgeAfter: new Date(Date.now() + 7 * 86_400_000),
          buildAsset: {
            create: {
              storageKey: finalKey,
              bucket,
              originalFileName: "test.apk",
              contentType: "application/vnd.android.package-archive",
              fileSizeBytes: 100n,
              sha256Checksum: "0".repeat(64),
            },
          },
        },
      });
      const deletion = await task(finalKey, "UploadFinal", upload.id);
      const before = await reserved();
      await expect(purge(form(deletion.id))).rejects.toThrow(
        "referenced by a build asset",
      );
      expect((await storage.headObject(finalKey)).ContentLength).toBe(100);
      expect(await reserved()).toBe(before);
      // The same physical object is eligible only through its explicitly approved release task.
      await prisma.storageDeletionTask.update({
        where: { id: deletion.id },
        data: { resourceType: "Release", resourceId: release.id },
      });
      await prisma.builderProfile.update({
        where: { userId },
        data: { usedStorageBytes: { increment: 100n } },
      });
      const usedBefore = (
        await prisma.builderProfile.findUniqueOrThrow({ where: { userId } })
      ).usedStorageBytes;
      await purge(form(deletion.id));
      expect(
        await prisma.release.findUnique({ where: { id: release.id } }),
      ).toBeNull();
      expect(
        (await prisma.builderProfile.findUniqueOrThrow({ where: { userId } }))
          .usedStorageBytes,
      ).toBe(usedBefore - 100n);
      await expect(storage.headObject(finalKey)).rejects.toMatchObject({
        $metadata: { httpStatusCode: 404 },
      });
    });
  },
);

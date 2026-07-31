import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import { AppError } from "@/src/lib/errors";
import { hashedAuthRateLimitStorage } from "@/src/lib/auth-rate-limit";
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";
import { createProjectWithinQuota } from "@/src/lib/project-quota";
import { reserveUploadQuota } from "@/src/lib/quota";
import { hashRateLimitIdentity } from "@/src/lib/rate-limit";
import {
  createSignedUploadUrl,
  deleteObject,
  downloadObjectToFile,
  getBucketName,
  headObject,
  storageClient,
} from "@/src/lib/storage/s3";

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === "true";
const integrationDescribe = integrationEnabled ? describe : describe.skip;
const runId = randomUUID();
const testEmailSuffix = `integration-${runId}@example.com`;
const rawAuthRateLimitKey = `integration-ip:${runId}`;
const hashedAuthKey = hashRateLimitIdentity(`better-auth:${rawAuthRateLimitKey}`);

function assertDisposableDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests.");

  const url = new URL(databaseUrl);
  const isLocal = ["127.0.0.1", "localhost"].includes(url.hostname);
  const isTestDatabase = url.pathname.toLowerCase().includes("test");
  if (!isLocal || !isTestDatabase) {
    throw new Error("Integration tests only run against a local disposable database whose name contains 'test'.");
  }
}

async function ensureDisposableBucket() {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint || !["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname)) {
    throw new Error("Integration tests only run against local disposable object storage.");
  }

  try {
    await storageClient.send(new CreateBucketCommand({ Bucket: getBucketName() }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (!["BucketAlreadyExists", "BucketAlreadyOwnedByYou"].includes(name)) throw error;
  }
}

integrationDescribe("public beta database invariants", () => {
  let builderId: string;
  let projectId: string;

  beforeAll(async () => {
    assertDisposableDatabase();
    await prisma.$connect();
    await ensureDisposableBucket();

    const builder = await prisma.user.create({
      data: {
        name: "Integration Builder",
        email: `builder-${testEmailSuffix}`,
        emailVerified: true,
        builderProfile: {
          create: {
            maxProjects: 1,
            maxStoredReleases: 5,
            maxApkBytes: 1_000,
            maxStorageBytes: 1_000,
          },
        },
      },
    });
    builderId = builder.id;

    const project = await prisma.appProject.create({
      data: {
        ownerId: builder.id,
        name: "Integration App",
        slug: `integration-${runId}`,
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: testEmailSuffix } } });
    await prisma.rateLimit.deleteMany({ where: { key: hashedAuthKey } });
    await prisma.$disconnect();
  });

  it("stores auth rate-limit identities as atomic HMAC keys", async () => {
    const results = await Promise.all([
      hashedAuthRateLimitStorage.consume!(rawAuthRateLimitKey, { window: 900, max: 1 }),
      hashedAuthRateLimitStorage.consume!(rawAuthRateLimitKey, { window: 900, max: 1 }),
    ]);

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    const stored = await prisma.rateLimit.findUniqueOrThrow({ where: { key: hashedAuthKey } });
    expect(stored.key).toHaveLength(64);
    expect(stored.key).not.toContain(rawAuthRateLimitKey);
  });

  it("uploads, verifies, streams, and deletes a private object", async () => {
    const storageKey = `integration/${runId}/stream.bin`;
    const body = Buffer.from("seekerhub-storage-integration");
    const uploadUrl = await createSignedUploadUrl({
      key: storageKey,
      contentType: "application/octet-stream",
      contentLength: body.byteLength,
    });
    const directory = await mkdtemp(join(tmpdir(), "seekerhub-storage-test-"));
    const filePath = join(directory, "download.bin");

    try {
      const upload = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "x-amz-meta-expected-size": String(body.byteLength),
        },
        body,
      });
      expect(upload.ok).toBe(true);

      const head = await headObject(storageKey);
      expect(head.ContentLength).toBe(body.byteLength);
      expect(head.Metadata?.["expected-size"]).toBe(String(body.byteLength));

      await downloadObjectToFile(storageKey, filePath);
      expect(await readFile(filePath)).toEqual(body);
    } finally {
      await deleteObject(storageKey).catch(() => undefined);
      await unlink(filePath).catch(() => undefined);
      await rmdir(directory).catch(() => undefined);
    }
  });

  it("prevents concurrent upload reservations from exceeding storage quota", async () => {
    const reserve = (suffix: string) =>
      reserveUploadQuota({
        userId: builderId,
        projectId,
        bytes: 600,
        storageKey: `integration/${runId}/${suffix}.apk`,
        fileName: `${suffix}.apk`,
        contentType: "application/vnd.android.package-archive",
        draft: { versionName: "1.0.0", versionCode: 1 },
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });

    const results = await Promise.allSettled([reserve("one"), reserve("two")]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const quotaError = (rejected[0] as PromiseRejectedResult).reason;
    expect(quotaError).toBeInstanceOf(AppError);
    expect(quotaError).toMatchObject({ code: "STORAGE_QUOTA_EXCEEDED" });

    const profile = await prisma.builderProfile.findUniqueOrThrow({ where: { userId: builderId } });
    expect(profile.reservedStorageBytes).toBe(600n);
    expect(await prisma.releaseUploadSession.count({ where: { userId: builderId } })).toBe(1);
  });

  it("prevents concurrent project creation from exceeding builder quota", async () => {
    await prisma.builderProfile.update({ where: { userId: builderId }, data: { maxProjects: 2 } });
    const results = await Promise.allSettled([
      createProjectWithinQuota({ userId: builderId, name: "Second App", description: null }),
      createProjectWithinQuota({ userId: builderId, name: "Another App", description: null }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AppError);
    expect(rejected.reason).toMatchObject({ code: "PROJECT_QUOTA_EXCEEDED" });
    expect(await prisma.appProject.count({ where: { ownerId: builderId } })).toBe(2);
  });

  it("grants only one tester when concurrent claims compete for one seat", async () => {
    const release = await prisma.release.create({
      data: {
        projectId,
        createdById: builderId,
        versionName: "1.0.0",
        versionCode: 1,
        changelog: "Integration release",
        accessPolicy: { create: { requireInviteAcceptance: true } },
      },
    });
    const invite = await prisma.inviteLink.create({
      data: {
        projectId,
        releaseId: release.id,
        createdById: builderId,
        label: "One seat",
        tokenHash: `integration-${runId}`,
        maxUses: 1,
      },
    });
    const testers = await Promise.all(
      ["one", "two"].map((suffix) =>
        prisma.user.create({
          data: {
            name: `Tester ${suffix}`,
            email: `${suffix}-${testEmailSuffix}`,
            emailVerified: true,
            inviteClaims: { create: { inviteLinkId: invite.id } },
          },
        }),
      ),
    );

    await Promise.all(testers.map((tester) => reconcilePendingInviteGrants(tester.id, projectId)));

    expect(
      await prisma.inviteClaim.count({
        where: { inviteLinkId: invite.id, grantedAt: { not: null }, revokedAt: null },
      }),
    ).toBe(1);
  });

  it("does not grant a new claim while project tester access is revoked", async () => {
    const release = await prisma.release.findFirstOrThrow({ where: { projectId } });
    const invite = await prisma.inviteLink.create({
      data: {
        projectId,
        releaseId: release.id,
        createdById: builderId,
        label: "Revoked tester",
        tokenHash: `revoked-${runId}`,
      },
    });
    const tester = await prisma.user.create({
      data: {
        name: "Revoked Tester",
        email: `revoked-${testEmailSuffix}`,
        emailVerified: true,
        inviteClaims: { create: { inviteLinkId: invite.id } },
        testerAccesses: { create: { projectId, revokedAt: new Date() } },
      },
    });

    await reconcilePendingInviteGrants(tester.id, projectId);

    const claim = await prisma.inviteClaim.findUniqueOrThrow({
      where: { inviteLinkId_userId: { inviteLinkId: invite.id, userId: tester.id } },
    });
    expect(claim.grantedAt).toBeNull();
  });
});

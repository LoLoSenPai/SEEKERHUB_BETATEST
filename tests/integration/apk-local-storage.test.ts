import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreateBucketCommand, DeleteBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { apkFixture } from "@/tests/fixtures/apk";

// Use the same injected local environment and opt-in as the rest of the integration suite.
const enabled = process.env.RUN_INTEGRATION_TESTS === "true";

function assertDisposableEnvironment() {
  const databaseUrl = process.env.DATABASE_URL;
  const endpoint = process.env.S3_ENDPOINT;
  if (!databaseUrl || !endpoint) throw new Error("DATABASE_URL and S3_ENDPOINT must be injected for integration tests.");
  const database = new URL(databaseUrl);
  const storage = new URL(endpoint);
  const loopback = ["127.0.0.1", "localhost", "[::1]"];
  if (!loopback.includes(database.hostname) || !database.pathname.toLowerCase().includes("test")) {
    throw new Error("APK integration tests require a local disposable database whose name contains 'test'.");
  }
  if (!loopback.includes(storage.hostname) || !["http:", "https:"].includes(storage.protocol)) {
    throw new Error("APK integration tests require loopback object storage.");
  }
}

describe.skipIf(!enabled)("local APK immutable storage boundary", () => {
  it("keeps inspected final bytes intact after replaying the staging PUT", async () => {
    assertDisposableEnvironment();
    const bucket = `apk-security-test-${randomUUID()}`;
    // Only the bucket is overridden; endpoint, port and credentials come from the runner.
    vi.stubEnv("S3_BUCKET", bucket);
    const stageKey = "projects/test/release-upload-sessions/staging/release.apk";
    const finalKey = "projects/test/inspected-apks/session/release.apk";
    const directory = await mkdtemp(join(tmpdir(), "apk-docker-test-"));
    let storage: typeof import("@/src/lib/storage/s3") | undefined;
    let bucketCreated = false;
    try {
      storage = await import("@/src/lib/storage/s3");
      const { inspectApkFile } = await import("@/src/lib/apk");
      expect(storage.getBucketName()).toBe(bucket);
      await storage.storageClient.send(new CreateBucketCommand({ Bucket: bucket }));
      bucketCreated = true;
      const original = apkFixture();
      const signed = await storage.createSignedUploadUrl({ key: stageKey, contentType: "application/vnd.android.package-archive", contentLength: original.length });
      const put = (bytes: Buffer) => fetch(signed, { method: "PUT", body: new Uint8Array(bytes), headers: {
        "content-type": "application/vnd.android.package-archive", "content-length": String(bytes.length),
      } });
      expect((await put(original)).ok).toBe(true);
      const snapshot = join(directory, "snapshot.apk");
      await storage.downloadObjectToFile(stageKey, snapshot, BigInt(original.length));
      const metadata = await inspectApkFile(snapshot);
      await expect(storage.storageClient.send(new PutObjectCommand({
        Bucket: bucket, Key: finalKey, Body: original, ContentLength: original.length,
        ContentMD5: Buffer.alloc(16).toString("base64"), IfNoneMatch: "*",
      }))).rejects.toMatchObject({ name: "BadDigest", $metadata: { httpStatusCode: 400 } });
      await expect(storage.headObject(finalKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      await storage.uploadInspectedApk({ key: finalKey, filePath: snapshot, ...metadata, contentType: metadata.detectedMimeType });
      const replacement = Buffer.alloc(original.length, 0x41);
      expect((await put(replacement)).ok).toBe(true);
      const replayed = join(directory, "replayed.apk");
      await storage.downloadObjectToFile(stageKey, replayed, BigInt(replacement.length));
      expect(await readFile(replayed)).toEqual(replacement);
      await expect(storage.uploadInspectedApk({ key: finalKey, filePath: snapshot, ...metadata, contentType: metadata.detectedMimeType })).rejects.toMatchObject({ $metadata: { httpStatusCode: 412 } });
      const recovered = join(directory, "recovered.apk");
      await storage.downloadObjectToFile(finalKey, recovered, BigInt(original.length));
      expect(await readFile(recovered)).toEqual(original);
      expect((await inspectApkFile(recovered)).sha256Checksum).toBe(metadata.sha256Checksum);
    } finally {
      try {
        if (bucketCreated && storage) {
          // Never delete an injected bucket: only the random bucket created above is owned here.
          const deletions = await Promise.allSettled([storage.deleteObject(stageKey), storage.deleteObject(finalKey)]);
          const failures = deletions.filter((result) => result.status === "rejected");
          if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "APK test object cleanup failed.");
          await storage.storageClient.send(new DeleteBucketCommand({ Bucket: bucket }));
        }
      } finally {
        storage?.storageClient.destroy();
        vi.unstubAllEnvs();
        await rm(directory, { recursive: true, force: true });
      }
    }
  }, 30_000);
});

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerEnv } from "@/src/lib/env";

const env = getServerEnv();

export const storageClient = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  // R2 supports Content-MD5 on PutObject; do not wrap streams in optional checksum trailers.
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

export async function createSignedUploadUrl({
  key,
  contentType,
  contentLength,
}: {
  key: string;
  contentType: string;
  contentLength: number;
}) {
  if (key.includes("/inspected-apks/")) throw new Error("Inspected APK keys cannot receive upload URLs.");
  return getSignedUrl(
    storageClient,
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: 60 * 15 },
  );
}

export async function createSignedDownloadUrl(key: string, fileName = "release.apk") {
  return getSignedUrl(
    storageClient,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/["\\\r\n]/g, "-")}"`,
    }),
    { expiresIn: 60 },
  );
}

export async function headObject(key: string) {
  return storageClient.send(
    new HeadObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
    { abortSignal: AbortSignal.timeout(15_000) },
  );
}

export async function downloadObjectToFile(key: string, filePath: string, expectedSize?: bigint) {
  if (expectedSize !== undefined && (expectedSize <= 0n || expectedSize > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new Error("Invalid expected APK size.");
  }
  const signal = AbortSignal.timeout(90_000);
  const response = await storageClient.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
    { abortSignal: signal },
  );

  if (!response.Body || !(response.Body instanceof ReadableStream || "pipe" in response.Body)) {
    throw new Error("Storage returned an unreadable object stream.");
  }

  const source = "pipe" in response.Body
    ? response.Body as Readable
    : Readable.fromWeb(response.Body as unknown as Parameters<typeof Readable.fromWeb>[0]);
  const expected = expectedSize ?? (response.ContentLength == null ? null : BigInt(response.ContentLength));
  if (expected === null || expected <= 0n || response.ContentLength == null || BigInt(response.ContentLength) !== expected) {
    source.destroy();
    throw new Error("The stored object size does not match the reserved upload.");
  }
  let received = 0n;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += BigInt(chunk.length);
      if (received > expected) callback(new Error("APK stream exceeded the reserved upload size."));
      else callback(null, chunk);
    },
    flush(callback) {
      callback(received === expected ? undefined : new Error("APK stream ended before the reserved upload size."));
    },
  });
  let created = false;
  const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
  output.once("open", () => { created = true; });
  try {
    await pipeline(source, limiter, output, { signal });
  } catch (error) {
    if (created) await unlink(filePath).catch(() => undefined);
    throw error;
  }
}

export async function uploadInspectedApk(input: {
  key: string;
  filePath: string;
  fileSizeBytes: bigint;
  sha256Checksum: string;
  contentType: string;
}) {
  if (!input.key.includes("/inspected-apks/")) throw new Error("An inspected APK requires a separate final key.");
  if (input.fileSizeBytes <= 0n || input.fileSizeBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Invalid inspected APK size.");
  }
  const signal = AbortSignal.timeout(90_000);
  const file = await open(input.filePath, "r");
  try {
    const md5 = createHash("md5");
    const sha256 = createHash("sha256");
    let bytes = 0n;
    const hashing = file.createReadStream({ start: 0, autoClose: false, signal });
    for await (const chunk of hashing) {
      bytes += BigInt(chunk.length);
      if (bytes > input.fileSizeBytes) throw new Error("Inspected APK exceeds its expected size.");
      md5.update(chunk);
      sha256.update(chunk);
    }
    if (bytes !== input.fileSizeBytes || sha256.digest("hex") !== input.sha256Checksum) {
      throw new Error("Inspected APK bytes no longer match the validated size and SHA256.");
    }
    // MD5 is only the R2-supported transport check. SHA256 remains the inspection identity.
    // Reuse the same open file, avoiding a path replacement between hashing and uploading.
    const body = file.createReadStream({ start: 0, autoClose: false, signal });
    try {
      await storageClient.send(new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: input.key,
        Body: body,
        ContentLength: Number(input.fileSizeBytes),
        ContentType: input.contentType,
        IfNoneMatch: "*",
        ContentMD5: md5.digest("base64"),
        Metadata: { sha256: input.sha256Checksum },
      }), { abortSignal: signal });
    } finally {
      body.destroy();
    }
  } finally {
    await file.close();
  }
}

export async function deleteObject(key: string) {
  await storageClient.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

export async function checkStorageConnection() {
  await storageClient.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
}

export function getBucketName() {
  return env.S3_BUCKET;
}

import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerEnv } from "@/src/lib/env";

const env = getServerEnv();

export const storageClient = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
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
  return getSignedUrl(
    storageClient,
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      Metadata: { "expected-size": String(contentLength) },
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
  );
}

export async function downloadObjectToFile(key: string, filePath: string) {
  const response = await storageClient.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );

  if (!response.Body || !(response.Body instanceof ReadableStream || "pipe" in response.Body)) {
    throw new Error("Storage returned an unreadable object stream.");
  }

  if ("pipe" in response.Body) {
    await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(filePath));
    return;
  }

  // Fallback for WHATWG streams when the runtime does not expose the AWS body mixin helpers.
  await pipeline(
    Readable.fromWeb(response.Body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(filePath),
  );
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

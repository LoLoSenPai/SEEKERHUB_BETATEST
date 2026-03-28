import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { buffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
}: {
  key: string;
  contentType: string;
}) {
  return getSignedUrl(
    storageClient,
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 60 * 15 },
  );
}

export async function createSignedDownloadUrl(key: string) {
  return getSignedUrl(
    storageClient,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
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

  if ("transformToByteArray" in response.Body && typeof response.Body.transformToByteArray === "function") {
    const bytes = await response.Body.transformToByteArray();
    await writeFile(filePath, Buffer.from(bytes));
    return;
  }

  if ("pipe" in response.Body) {
    await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(filePath));
    return;
  }

  // Fallback for WHATWG streams when the runtime does not expose the AWS body mixin helpers.
  const arrayBuffer = await new Response(response.Body as ReadableStream).arrayBuffer();
  await writeFile(filePath, Buffer.from(arrayBuffer));
}

export async function downloadObjectBytes(key: string) {
  const response = await storageClient.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );

  if (!response.Body || !(response.Body instanceof ReadableStream || "pipe" in response.Body)) {
    throw new Error("Storage returned an unreadable object stream.");
  }

  if ("transformToByteArray" in response.Body && typeof response.Body.transformToByteArray === "function") {
    return Buffer.from(await response.Body.transformToByteArray());
  }

  if ("pipe" in response.Body) {
    return buffer(response.Body as NodeJS.ReadableStream);
  }

  const arrayBuffer = await new Response(response.Body as ReadableStream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function getBucketName() {
  return env.S3_BUCKET;
}

import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getBucketName, storageClient } from "./s3";

export const MEDIA_URL_TTL_SECONDS = 60;

export async function uploadNormalizedMedia(key: string, data: Buffer) {
  if (!/^projects\/[a-zA-Z0-9_-]+\/media\/[a-zA-Z0-9_-]+\.webp$/.test(key)) throw new Error("Invalid media storage key.");
  await storageClient.send(new PutObjectCommand({
    Bucket: getBucketName(), Key: key, Body: data, ContentLength: data.length,
    ContentType: "image/webp", ContentDisposition: "inline",
    CacheControl: "private, no-store", IfNoneMatch: "*",
    ContentMD5: createHash("md5").update(data).digest("base64"),
  }), { abortSignal: AbortSignal.timeout(20_000) });
}

export async function createSignedMediaUrl(key: string) {
  return getSignedUrl(storageClient, new GetObjectCommand({
    Bucket: getBucketName(), Key: key,
    ResponseContentType: "image/webp", ResponseContentDisposition: "inline",
    ResponseCacheControl: "private, no-store",
  }), { expiresIn: MEDIA_URL_TTL_SECONDS });
}

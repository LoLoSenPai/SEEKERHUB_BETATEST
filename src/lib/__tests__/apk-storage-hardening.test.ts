import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/env", () => ({
  getServerEnv: () => ({
    S3_REGION: "test", S3_ENDPOINT: "http://127.0.0.1:9000", S3_FORCE_PATH_STYLE: true,
    S3_ACCESS_KEY_ID: "local", S3_SECRET_ACCESS_KEY: "local", S3_BUCKET: "local-tests",
  }),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

import { createSignedUploadUrl, downloadObjectToFile, storageClient, uploadInspectedApk } from "@/src/lib/storage/s3";

let directory: string;
const send = vi.spyOn(storageClient, "send");
beforeEach(async () => {
  send.mockReset();
  directory = await mkdtemp(join(tmpdir(), "apk-storage-test-"));
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("APK storage byte integrity", () => {
  it("writes exactly the expected bytes from the GET stream", async () => {
    send.mockResolvedValue({ ContentLength: 6, Body: Readable.from([Buffer.from("abc"), Buffer.from("def")]) } as never);
    const path = join(directory, "download.apk");
    await downloadObjectToFile("staging", path, 6n);
    expect(await readFile(path, "utf8")).toBe("abcdef");
  });
  it.each(["overflow", "truncated", "stream-error", "head-mismatch"])("rejects %s and removes partial files", async (kind) => {
    const body = kind === "stream-error" ? Readable.from((async function* () {
      yield Buffer.from("ab"); throw new Error("connection lost");
    })()) : Readable.from([Buffer.from(kind === "overflow" ? "abcdefg" : "ab")]);
    send.mockResolvedValue({ ContentLength: kind === "head-mismatch" ? 100 : 6, Body: body } as never);
    const path = join(directory, "download.apk");
    await expect(downloadObjectToFile("staging", path, 6n)).rejects.toThrow();
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(body.destroyed).toBe(true);
  });
  it("refuses to overwrite an existing local snapshot", async () => {
    const path = join(directory, "download.apk");
    await writeFile(path, "original");
    send.mockResolvedValue({ ContentLength: 6, Body: Readable.from([Buffer.from("abcdef")]) } as never);
    await expect(downloadObjectToFile("staging", path, 6n)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("original");
  });
  it("uploads inspected bytes with conditional create, Content-MD5 and SHA256 metadata", async () => {
    const bytes = Buffer.from("inspected APK snapshot");
    const path = join(directory, "snapshot.apk");
    await writeFile(path, bytes);
    const sha256Checksum = createHash("sha256").update(bytes).digest("hex");
    send.mockImplementation((async (command: { input: { Body: Readable } }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of command.input.Body) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(bytes);
      return {};
    }) as never);
    await uploadInspectedApk({ key: "projects/test/inspected-apks/session/release.apk", filePath: path,
      fileSizeBytes: BigInt(bytes.length), sha256Checksum, contentType: "application/vnd.android.package-archive" });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].input).toMatchObject({
      IfNoneMatch: "*", ContentLength: bytes.length, ContentMD5: createHash("md5").update(bytes).digest("base64"),
      Metadata: { sha256: sha256Checksum },
    });
    expect(send.mock.calls[0][0].input).not.toHaveProperty("ChecksumSHA256");
    expect(send.mock.calls[0][0].input).not.toHaveProperty("ChecksumAlgorithm");
  });
  it("never falls back to an overwrite after a failed conditional PUT", async () => {
    const path = join(directory, "snapshot.apk");
    await writeFile(path, "abc");
    send.mockRejectedValue({ $metadata: { httpStatusCode: 412 } });
    await expect(uploadInspectedApk({ key: "projects/test/inspected-apks/session/release.apk", filePath: path,
      fileSizeBytes: 3n, sha256Checksum: createHash("sha256").update("abc").digest("hex"), contentType: "application/octet-stream" })).rejects.toMatchObject({ $metadata: { httpStatusCode: 412 } });
    expect(send).toHaveBeenCalledOnce();
  });
  it("refuses to presign PUTs for inspected final keys", async () => {
    await expect(createSignedUploadUrl({ key: "projects/test/inspected-apks/session/release.apk", contentType: "application/octet-stream", contentLength: 3 })).rejects.toThrow("cannot receive upload URLs");
  });
  it.each(["changed", "oversized", "truncated"])("refuses a %s local snapshot before any PUT", async (kind) => {
    const path = join(directory, "snapshot.apk");
    await writeFile(path, kind === "oversized" ? "abcd" : kind === "truncated" ? "ab" : "def");
    await expect(uploadInspectedApk({ key: "projects/test/inspected-apks/session/release.apk", filePath: path,
      fileSizeBytes: 3n, sha256Checksum: createHash("sha256").update("abc").digest("hex"), contentType: "application/octet-stream" })).rejects.toThrow("Inspected APK");
    expect(send).not.toHaveBeenCalled();
  });
  it("serializes a plain HTTPS PUT with Content-MD5 and no optional checksums or aws-chunked framing", async () => {
    const bytes = Buffer.alloc(96 * 1024, 0x5a);
    const path = join(directory, "snapshot.apk");
    await writeFile(path, bytes);
    const requestChecksumCalculation = await storageClient.config.requestChecksumCalculation();
    expect(requestChecksumCalculation).toBe("WHEN_REQUIRED");
    const requests: { headers: Record<string, string>; bytes: Buffer }[] = [];
    const wireClient = new S3Client({
      region: "auto", endpoint: "https://r2.invalid", credentials: { accessKeyId: "FAKE", secretAccessKey: "FAKE" },
      requestChecksumCalculation,
      // No sockets: exercise serialization, signing and checksum middleware, not a network server.
      requestHandler: { handle: async (request: { headers: Record<string, string>; body?: unknown }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request.body as Readable) chunks.push(chunk);
        requests.push({ headers: request.headers, bytes: Buffer.concat(chunks) });
        return { response: { statusCode: 200, headers: {}, body: Readable.from([]) } };
      } },
    });
    send.mockImplementation(((command) => wireClient.send(command)) as typeof storageClient.send);
    try {
      await uploadInspectedApk({ key: "projects/test/inspected-apks/session/release.apk", filePath: path,
        fileSizeBytes: BigInt(bytes.length), sha256Checksum: createHash("sha256").update(bytes).digest("hex"), contentType: "application/octet-stream" });
      expect(requests).toHaveLength(1);
      expect(requests[0].bytes).toEqual(bytes);
      expect(requests[0].headers).toMatchObject({
        "content-length": String(bytes.length), "if-none-match": "*",
        "content-md5": createHash("md5").update(bytes).digest("base64"),
        "x-amz-meta-sha256": createHash("sha256").update(bytes).digest("hex"),
      });
      expect(requests[0].headers["content-encoding"]).toBeUndefined();
      expect(requests[0].headers["transfer-encoding"]).toBeUndefined();
      expect(requests[0].headers["x-amz-trailer"]).toBeUndefined();
      expect(Object.keys(requests[0].headers).some((name) => name.startsWith("x-amz-checksum-") || name === "x-amz-sdk-checksum-algorithm")).toBe(false);
    } finally {
      wireClient.destroy();
    }
  });
});

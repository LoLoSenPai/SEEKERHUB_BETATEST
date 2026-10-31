import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { fileTypeFromFile } from "file-type";
import { readApkManifest } from "./apk-worker";

const APK_SIGNATURE_MAGIC = Buffer.from("APK Sig Block 42", "ascii");

export function sanitizeObjectName(fileName: string) {
  return basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function assertApkName(fileName: string) {
  if (extname(fileName).toLowerCase() !== ".apk") throw new Error("Only a single .apk file is accepted.");
}

async function hashAndDetectSignature(filePath: string) {
  return new Promise<{ sha256Checksum: string; hasV2SignatureBlock: boolean }>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    let carry = Buffer.alloc(0);
    let hasV2SignatureBlock = false;

    stream.on("data", (rawChunk) => {
      const chunk = typeof rawChunk === "string" ? Buffer.from(rawChunk) : rawChunk;
      hash.update(chunk);
      if (!hasV2SignatureBlock) {
        const scan = Buffer.concat([carry, chunk]);
        hasV2SignatureBlock = scan.includes(APK_SIGNATURE_MAGIC);
        carry = scan.subarray(Math.max(0, scan.length - APK_SIGNATURE_MAGIC.length + 1));
      }
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({ sha256Checksum: hash.digest("hex"), hasV2SignatureBlock }));
  });
}

export async function calculateFileSha256(filePath: string) {
  return (await hashAndDetectSignature(filePath)).sha256Checksum;
}

function integerOrNull(value: string | number | undefined) {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function inspectApkFile(filePath: string) {
  const zip = await readApkManifest(filePath);
  const checks = await Promise.allSettled([
    fileTypeFromFile(filePath),
    hashAndDetectSignature(filePath),
  ]);
  // Do not return early on one failure while another task still owns the local snapshot.
  const [typeCheck, hashCheck] = checks;
  if (typeCheck.status === "rejected") throw typeCheck.reason;
  if (hashCheck.status === "rejected") throw hashCheck.reason;
  const detectedType = typeCheck.value;
  const hashResult = hashCheck.value;
  const manifest = zip.manifest;

  const packageName = typeof manifest.package === "string" ? manifest.package.trim() : "";
  const versionName = String(manifest.versionName ?? "").trim();
  const versionCode = integerOrNull(manifest.versionCode);
  if (!packageName || !versionName || !versionCode || versionCode <= 0) {
    throw new Error("The APK manifest is missing package, versionName, or versionCode metadata.");
  }

  const hasApkSignature = zip.hasV1SignatureFiles || hashResult.hasV2SignatureBlock;
  if (!hasApkSignature) {
    throw new Error("No APK signature scheme marker was found. Build and sign a release APK before uploading.");
  }

  return {
    detectedMimeType: detectedType?.mime ?? "application/vnd.android.package-archive",
    fileSizeBytes: BigInt(statSync(filePath).size),
    sha256Checksum: hashResult.sha256Checksum,
    packageName,
    versionName,
    versionCode,
    minSdk: integerOrNull(manifest.usesSdk?.minSdkVersion),
    targetSdk: integerOrNull(manifest.usesSdk?.targetSdkVersion),
    hasApkSignature,
  };
}

export async function inspectApkBuffer(fileBuffer: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "seekerhub-apk-buffer-"));
  try {
    const filePath = join(directory, "release.apk");
    await writeFile(filePath, fileBuffer, { flag: "wx", mode: 0o600 });
    return await inspectApkFile(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

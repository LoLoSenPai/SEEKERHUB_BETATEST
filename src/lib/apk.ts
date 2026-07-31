import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { basename, extname } from "node:path";
import ApkReader from "@devicefarmer/adbkit-apkreader";
import { fileTypeFromBuffer, fileTypeFromFile } from "file-type";
import yauzl from "yauzl";

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

function invalidApkError() {
  return new Error(
    "Uploaded file is not a valid APK archive. Upload a single .apk file, not an .aab, .apks, .xapk, or renamed file.",
  );
}

async function inspectZipEntries(filePath: string) {
  return new Promise<{ hasAndroidManifest: boolean; hasV1SignatureFiles: boolean }>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) return reject(invalidApkError());
      let hasAndroidManifest = false;
      let hasV1SignatureFiles = false;
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (entry.fileName === "AndroidManifest.xml") hasAndroidManifest = true;
        if (/^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(entry.fileName)) hasV1SignatureFiles = true;
        zipfile.readEntry();
      });
      zipfile.on("end", () => resolve({ hasAndroidManifest, hasV1SignatureFiles }));
      zipfile.on("error", () => reject(invalidApkError()));
    });
  });
}

async function inspectZipEntriesFromBuffer(fileBuffer: Buffer) {
  return new Promise<{ hasAndroidManifest: boolean; hasV1SignatureFiles: boolean }>((resolve, reject) => {
    yauzl.fromBuffer(fileBuffer, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) return reject(invalidApkError());
      let hasAndroidManifest = false;
      let hasV1SignatureFiles = false;
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (entry.fileName === "AndroidManifest.xml") hasAndroidManifest = true;
        if (/^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(entry.fileName)) hasV1SignatureFiles = true;
        zipfile.readEntry();
      });
      zipfile.on("end", () => resolve({ hasAndroidManifest, hasV1SignatureFiles }));
      zipfile.on("error", () => reject(invalidApkError()));
    });
  });
}

function integerOrNull(value: string | number | undefined) {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function inspectApkFile(filePath: string) {
  const [detectedType, zip, hashResult, reader] = await Promise.all([
    fileTypeFromFile(filePath),
    inspectZipEntries(filePath),
    hashAndDetectSignature(filePath),
    ApkReader.open(filePath),
  ]);
  if (!zip.hasAndroidManifest) throw new Error("The archive does not contain AndroidManifest.xml.");

  let manifest;
  try {
    manifest = await reader.readManifest();
  } catch {
    throw new Error("AndroidManifest.xml could not be parsed from this APK.");
  }

  const packageName = manifest.package?.trim();
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
  const detectedType = await fileTypeFromBuffer(fileBuffer);
  const zip = await inspectZipEntriesFromBuffer(fileBuffer);
  if (!zip.hasAndroidManifest) throw new Error("Uploaded archive is not a valid Android APK.");
  return {
    detectedMimeType: detectedType?.mime ?? "application/vnd.android.package-archive",
    fileSizeBytes: BigInt(fileBuffer.byteLength),
    sha256Checksum: createHash("sha256").update(fileBuffer).digest("hex"),
    hasApkSignature: zip.hasV1SignatureFiles || fileBuffer.includes(APK_SIGNATURE_MAGIC),
  };
}

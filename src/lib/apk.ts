import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { fileTypeFromBuffer, fileTypeFromFile } from "file-type";
import yauzl from "yauzl";

export function sanitizeObjectName(fileName: string) {
  return basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function assertApkName(fileName: string) {
  if (extname(fileName).toLowerCase() !== ".apk") {
    throw new Error("Only .apk files are accepted.");
  }
}

export async function calculateFileSha256(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function calculateBufferSha256(fileBuffer: Buffer) {
  return createHash("sha256").update(fileBuffer).digest("hex");
}

async function inspectZipEntries(filePath: string) {
  return new Promise<{ hasAndroidManifest: boolean }>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(
          new Error(
            "Uploaded file is not a valid APK archive. Upload a single .apk file, not an .aab, .apks, .xapk, or a renamed non-APK file.",
          ),
        );
        return;
      }

      let hasAndroidManifest = false;

      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (entry.fileName === "AndroidManifest.xml") {
          hasAndroidManifest = true;
        }

        zipfile.readEntry();
      });

      zipfile.on("end", () => resolve({ hasAndroidManifest }));
      zipfile.on("error", reject);
    });
  });
}

async function inspectZipEntriesFromBuffer(fileBuffer: Buffer) {
  return new Promise<{ hasAndroidManifest: boolean }>((resolve, reject) => {
    yauzl.fromBuffer(fileBuffer, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(
          new Error(
            "Uploaded file is not a valid APK archive. Upload a single .apk file, not an .aab, .apks, .xapk, or a renamed non-APK file.",
          ),
        );
        return;
      }

      let hasAndroidManifest = false;

      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (entry.fileName === "AndroidManifest.xml") {
          hasAndroidManifest = true;
        }

        zipfile.readEntry();
      });

      zipfile.on("end", () => resolve({ hasAndroidManifest }));
      zipfile.on("error", reject);
    });
  });
}

export async function inspectApkFile(filePath: string) {
  const detectedType = await fileTypeFromFile(filePath);
  const { hasAndroidManifest } = await inspectZipEntries(filePath);
  const sha256Checksum = await calculateFileSha256(filePath);
  const fileSizeBytes = BigInt(statSync(filePath).size);

  if (!hasAndroidManifest) {
    throw new Error("Uploaded archive is not a valid Android APK.");
  }

  return {
    detectedMimeType: detectedType?.mime ?? "application/vnd.android.package-archive",
    fileSizeBytes,
    sha256Checksum,
  };
}

export async function inspectApkBuffer(fileBuffer: Buffer) {
  const detectedType = await fileTypeFromBuffer(fileBuffer);
  const { hasAndroidManifest } = await inspectZipEntriesFromBuffer(fileBuffer);
  const sha256Checksum = calculateBufferSha256(fileBuffer);
  const fileSizeBytes = BigInt(fileBuffer.byteLength);

  if (!hasAndroidManifest) {
    throw new Error("Uploaded archive is not a valid Android APK.");
  }

  return {
    detectedMimeType: detectedType?.mime ?? "application/vnd.android.package-archive",
    fileSizeBytes,
    sha256Checksum,
  };
}

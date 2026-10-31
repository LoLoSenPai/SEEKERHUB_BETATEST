"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Native CJS worker, executed without a TS loader or eval. */

const { parentPort, workerData } = require("node:worker_threads");
const yauzl = require("yauzl");
const ManifestParser = require("@devicefarmer/adbkit-apkreader/lib/apkreader/parser/manifest");

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 100000;
const MAX_STRINGS = 100000;

function validateBinaryXml(buffer) {
  const invalid = () => { throw new Error("Invalid AndroidManifest.xml binary XML structure."); };
  if (buffer.length < 8 || buffer.length > MAX_MANIFEST_BYTES ||
      buffer.readUInt16LE(0) !== 3 || buffer.readUInt16LE(2) !== 8 ||
      buffer.readUInt32LE(4) !== buffer.length) invalid();
  let offset = 8;
  let stringCount = 0;
  let poolSeen = false;
  let rootSeen = false;
  const stack = [];
  const ref = (at, nullable = false) => {
    const value = buffer.readUInt32LE(at);
    if (!(nullable && value === 0xffffffff) && value >= stringCount) invalid();
    return value;
  };
  while (offset < buffer.length) {
    if (buffer.length - offset < 8) invalid();
    const type = buffer.readUInt16LE(offset);
    const header = buffer.readUInt16LE(offset + 2);
    const size = buffer.readUInt32LE(offset + 4);
    const end = offset + size;
    if (header < 8 || size < header || size % 4 || end > buffer.length) invalid();
    if (type === 1) {
      if (poolSeen || rootSeen || header !== 28 || size < 28) invalid();
      poolSeen = true;
      stringCount = buffer.readUInt32LE(offset + 8);
      const styles = buffer.readUInt32LE(offset + 12);
      const utf8 = Boolean(buffer.readUInt32LE(offset + 16) & 0x100);
      const start = buffer.readUInt32LE(offset + 20);
      const styleStart = buffer.readUInt32LE(offset + 24);
      const tableEnd = 28 + (stringCount + styles) * 4;
      if (stringCount > MAX_STRINGS || tableEnd > size || start < tableEnd || start > size ||
          (styles && (!styleStart || styleStart < start || styleStart > size))) invalid();
      const stringsEnd = offset + (styleStart || size);
      // Bound both offset tables and every variable-length string before invoking the legacy parser.
      for (let i = 0; i < stringCount; i++) {
        let cursor = offset + start + buffer.readUInt32LE(offset + 28 + i * 4);
        const length = () => {
          const width = utf8 ? 1 : 2;
          if (cursor + width > stringsEnd) invalid();
          const first = utf8 ? buffer[cursor] : buffer.readUInt16LE(cursor);
          cursor += width;
          const flag = utf8 ? 0x80 : 0x8000;
          if (!(first & flag)) return first;
          if (cursor + width > stringsEnd) invalid();
          const second = utf8 ? buffer[cursor] : buffer.readUInt16LE(cursor);
          cursor += width;
          return (first & (flag - 1)) * (utf8 ? 256 : 65536) + second;
        };
        if (cursor < offset + start || cursor >= stringsEnd) invalid();
        const chars = length();
        const bytes = utf8 ? length() : chars * 2;
        const width = utf8 ? 1 : 2;
        if (cursor + bytes + width > stringsEnd) invalid();
        if (utf8 ? buffer[cursor + bytes] !== 0 : buffer.readUInt16LE(cursor + bytes) !== 0) invalid();
      }
    } else if (type === 0x180) {
      if (!poolSeen || rootSeen || header !== 8 || (size - header) % 4) invalid();
    } else if ([0x100, 0x101, 0x102, 0x103, 0x104].includes(type)) {
      if (!poolSeen || header !== 16 || size < 24) invalid();
      ref(offset + 12, true);
      if (type === 0x102) {
        if (size < 36 || stack.length >= 256 || (!stack.length && rootSeen)) invalid();
        const namespace = ref(offset + 16, true);
        const name = ref(offset + 20);
        const count = buffer.readUInt16LE(offset + 28);
        if (buffer.readUInt16LE(offset + 24) !== 20 || buffer.readUInt16LE(offset + 26) !== 20 ||
            size !== 36 + count * 20) invalid();
        for (let at = offset + 36; at < end; at += 20) {
          ref(at, true);
          ref(at + 4);
          ref(at + 8, true);
          if (buffer.readUInt16LE(at + 12) !== 8 || buffer[at + 14] !== 0) invalid();
          if (buffer[at + 15] === 3) ref(at + 16);
        }
        stack.push([namespace, name]);
        rootSeen = true;
      } else if (type === 0x103) {
        if (size !== 24 || !stack.length) invalid();
        const [namespace, name] = stack.pop();
        if (ref(offset + 16, true) !== namespace || ref(offset + 20) !== name) invalid();
      } else if (type === 0x104) {
        if (size !== 28 || !stack.length || buffer.readUInt16LE(offset + 20) !== 8) invalid();
        ref(offset + 16, true);
        if (buffer[offset + 23] === 3) ref(offset + 24);
      } else {
        if (size !== 24) invalid();
        ref(offset + 16, true);
        ref(offset + 20);
      }
    } else {
      invalid();
    }
    offset = end;
  }
  if (!poolSeen || !rootSeen || stack.length) invalid();
}

async function inspect(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) return reject(new Error("Invalid APK archive."));
      let count = 0;
      let manifest;
      let signature = false;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };
      zip.on("error", fail);
      zip.on("entry", (entry) => {
        if (++count > MAX_ENTRIES) return fail(new Error("APK contains too many entries."));
        if (/^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(entry.fileName)) signature = true;
        if (entry.fileName !== "AndroidManifest.xml") return zip.readEntry();
        if (manifest) return fail(new Error("Duplicate AndroidManifest.xml entries."));
        if (entry.uncompressedSize < 8 || entry.uncompressedSize > MAX_MANIFEST_BYTES) {
          return fail(new Error("AndroidManifest.xml exceeds the manifest size limit or is truncated."));
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(error || new Error("Unreadable manifest."));
          const chunks = [];
          let bytes = 0;
          stream.on("error", fail);
          stream.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_MANIFEST_BYTES || bytes > entry.uncompressedSize) {
              stream.destroy(new Error("AndroidManifest.xml exceeds the manifest size limit."));
            } else chunks.push(chunk);
          });
          stream.on("end", () => {
            if (settled) return;
            try {
              if (bytes !== entry.uncompressedSize) throw new Error("Truncated AndroidManifest.xml.");
              const content = Buffer.concat(chunks, bytes);
              validateBinaryXml(content);
              manifest = new ManifestParser(content).parse();
              zip.readEntry();
            } catch (error) { fail(error); }
          });
        });
      });
      zip.on("end", () => {
        if (settled) return;
        if (!manifest) return fail(new Error("The archive does not contain AndroidManifest.xml."));
        settled = true;
        zip.close();
        resolve({
          manifest: {
            package: manifest.package,
            versionName: manifest.versionName,
            versionCode: manifest.versionCode,
            usesSdk: manifest.usesSdk && {
              minSdkVersion: manifest.usesSdk.minSdkVersion,
              targetSdkVersion: manifest.usesSdk.targetSdkVersion,
            },
          },
          hasV1SignatureFiles: signature,
        });
      });
      zip.readEntry();
    });
  });
}

if (parentPort && workerData?.apkManifestWorker === true) {
  inspect(workerData.filePath).then(
    (result) => parentPort.postMessage({ result }),
    (error) => parentPort.postMessage({ error: error.message }),
  );
}

module.exports = { validateBinaryXml, MAX_MANIFEST_BYTES };

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { inspectApkFile } from "@/src/lib/apk";
import { readApkManifest } from "@/src/lib/apk-worker";
import { apkFixture, binaryManifest } from "@/tests/fixtures/apk";

const directories: string[] = [];
async function file(bytes: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "apk-security-test-"));
  directories.push(directory);
  const path = join(directory, "fixture.apk");
  await writeFile(path, bytes);
  return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("bounded APK manifest inspection", () => {
  it("reads a valid binary manifest fixture with the installed parser in a worker", async () => {
    const bytes = apkFixture();
    await expect(inspectApkFile(await file(bytes))).resolves.toMatchObject({
      packageName: "com.example.beta", versionName: "1.2.3", versionCode: 42,
      fileSizeBytes: BigInt(bytes.length), sha256Checksum: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("rejects the zero-size string-pool chunk that loops forever in the legacy parser", async () => {
    const manifest = Buffer.alloc(36);
    manifest.writeUInt16LE(3); manifest.writeUInt16LE(8, 2); manifest.writeUInt32LE(36, 4);
    manifest.writeUInt16LE(1, 8); manifest.writeUInt16LE(28, 10);
    await expect(readApkManifest(await file(apkFixture(manifest)))).rejects.toThrow("binary XML structure");
  });

  it.each(["truncated", "oversized-chunk", "oversized-strings", "out-of-bounds-string", "oversized-attributes"])("rejects %s AXML", async (kind) => {
    let manifest = binaryManifest();
    if (kind === "truncated") manifest = manifest.subarray(0, manifest.length - 1);
    if (kind === "oversized-chunk") manifest.writeUInt32LE(0xffffffff, 12);
    if (kind === "oversized-strings") manifest.writeUInt32LE(0xffffffff, 16);
    if (kind === "out-of-bounds-string") manifest.writeUInt32LE(0xffffffff, 36);
    if (kind === "oversized-attributes") {
      const element = 8 + manifest.readUInt32LE(12);
      manifest.writeUInt16LE(65535, element + 28);
    }
    await expect(readApkManifest(await file(apkFixture(manifest)))).rejects.toThrow("binary XML structure");
  });

  it("rejects an oversized decompressed manifest before allocating it", async () => {
    await expect(readApkManifest(await file(apkFixture(binaryManifest(), { declaredSize: 4 * 1024 * 1024 + 1 })))).rejects.toThrow("size limit");
  });
  it("bounds the actual decompressed stream, not just its declared length", async () => {
    await expect(readApkManifest(await file(apkFixture(Buffer.alloc(4 * 1024 * 1024 + 100), { declaredSize: 1024 })))).rejects.toThrow();
  });
  it("rejects duplicate manifests", async () => {
    await expect(readApkManifest(await file(apkFixture(binaryManifest(), { duplicate: true })))).rejects.toThrow("Duplicate");
  });
  it("terminates the worker when its deadline expires", async () => {
    await expect(readApkManifest(await file(apkFixture()), 1)).rejects.toThrow("timed out");
  });

  it("traces the native worker and dependencies and runs from an isolated traced artifact", async () => {
    const require = createRequire(import.meta.url);
    const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
    const trace = await nodeFileTrace(["src/lib/apk-worker.ts"], {
      base: process.cwd(), processCwd: process.cwd(),
      readFile: async (path: string) => {
        try {
          const source = await readFile(path, "utf8");
          return path.endsWith(".ts") ? ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
          }).outputText : source;
        } catch (error) {
          if (["ENOENT", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
          throw error;
        }
      },
    });
    expect([...trace.warnings]).toEqual([]);
    expect([...trace.fileList].map((path: string) => path.replaceAll("\\", "/"))).toContain("src/lib/apk-manifest-worker.cjs");
    const artifact = await mkdtemp(join(tmpdir(), "apk-trace-test-"));
    directories.push(artifact);
    for (const path of trace.fileList as Set<string>) {
      await mkdir(dirname(join(artifact, path)), { recursive: true });
      await copyFile(path, join(artifact, path));
    }
    await writeFile(join(artifact, "fixture.apk"), apkFixture());
    const result = await new Promise<{ result?: { manifest: { package: string } } }>((resolve, reject) => {
      const worker = new Worker(join(artifact, "src/lib/apk-manifest-worker.cjs"), { workerData: { apkManifestWorker: true, filePath: join(artifact, "fixture.apk") } });
      worker.once("message", (message) => { void worker.terminate().then(() => resolve(message), reject); });
      worker.once("error", reject);
    });
    expect(result.result?.manifest.package).toBe("com.example.beta");
  });
  it("keeps worker dependencies traceable after Next SWC CommonJS compilation", async () => {
    const require = createRequire(import.meta.url);
    const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
    const swc = require("next/dist/build/swc");
    await swc.loadBindings();
    const trace = await nodeFileTrace(["src/lib/apk-worker.ts"], {
      base: process.cwd(), processCwd: process.cwd(),
      readFile: async (path: string) => {
        try {
          const source = await readFile(path, "utf8");
          return path.endsWith(".ts") ? (await swc.transform(source, {
            filename: path, jsc: { parser: { syntax: "typescript" }, target: "es2022" },
            module: { type: "commonjs", ignoreDynamic: true },
          })).code : source;
        } catch (error) {
          if (["ENOENT", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
          throw error;
        }
      },
    });
    expect([...trace.warnings]).toEqual([]);
    expect([...trace.fileList].map((path: string) => path.replaceAll("\\", "/"))).toEqual(expect.arrayContaining([
      "src/lib/apk-manifest-worker.cjs",
      "node_modules/@devicefarmer/adbkit-apkreader/lib/apkreader/parser/manifest.js",
      "node_modules/@devicefarmer/adbkit-apkreader/lib/apkreader/parser/binaryxml.js",
    ]));
  });
});

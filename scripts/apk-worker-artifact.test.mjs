import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { apkFixture } from "../tests/fixtures/apk.ts";
const execute = promisify(execFile);

// Run AFTER next build: node --test scripts/apk-worker-artifact.test.mjs
// APK_ARTIFACT_PROJECT_DIR can select a separately built copy without touching a running server.
test("real finalize NFT deploys both native and compiled APK workers without checkout modules", { timeout: 60_000 }, async () => {
  const project = resolve(process.env.APK_ARTIFACT_PROJECT_DIR || process.cwd());
  const manifest = JSON.parse(await readFile(join(project, ".next/required-server-files.json"), "utf8"));
  const root = resolve(manifest.config.outputFileTracingRoot || project);
  const within = (path) => {
    const result = relative(root, path);
    assert(!isAbsolute(result) && result !== ".." && !result.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`), `Trace path escapes root: ${path}`);
    return result;
  };
  const tracePath = join(project, ".next/server/app/api/uploads/releases/[sessionId]/finalize/route.js.nft.json");
  const trace = JSON.parse(await readFile(tracePath, "utf8"));
  const sourcePaths = trace.files.map((path) => resolve(dirname(tracePath), path));
  assert(sourcePaths.some((path) => path.replaceAll("\\", "/").endsWith("/adbkit-apkreader/lib/apkreader/parser/manifest.js")), "Real build NFT is missing native APK parser dependencies");
  const artifact = await mkdtemp(join(tmpdir(), "apk-real-next-artifact-"));
  const destination = (source) => join(artifact, within(source));
  const artifactProject = destination(project);
  const links = new Map(trace.symlinks || []);
  try {
    for (let i = 0; i < sourcePaths.length; i++) {
      if (links.has(i)) continue;
      const target = destination(sourcePaths[i]);
      const info = await stat(sourcePaths[i]);
      if (info.isDirectory()) await mkdir(target, { recursive: true });
      else {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(sourcePaths[i], target);
      }
    }
    for (const [index, target] of links) {
      const alias = destination(sourcePaths[index]);
      // Turbopack records both files and symlink targets relative to the NFT manifest.
      const aliasedSource = resolve(dirname(tracePath), target);
      const aliasedDestination = destination(aliasedSource);
      await mkdir(dirname(alias), { recursive: true });
      await symlink(aliasedDestination, alias, process.platform === "win32" ? "junction" : "dir");
    }
    // Only trace-listed files were copied. No symlink may point back into the checkout.
    const fixture = join(artifactProject, "fixture.apk");
    await mkdir(artifactProject, { recursive: true });
    await writeFile(fixture, apkFixture());
    const runner = join(artifactProject, "artifact-runner.mjs");
    await copyFile(fileURLToPath(new URL("./apk-artifact-runner.mjs", import.meta.url)), runner);
    const entries = [
      join(artifactProject, "src/lib/apk-manifest-worker.cjs"),
      ...sourcePaths.filter((path) => /[\\/]chunks[\\/].*apk-manifest-worker.*\.js$/.test(path)).map(destination),
    ];
    assert(entries.length >= 2, "The real build trace must include its compiled worker entry");
    for (const entry of entries) {
      const { stdout } = await execute(process.execPath, ["--no-global-search-paths", runner, entry, fixture], {
        cwd: artifactProject, env: { ...process.env, NODE_PATH: "" }, timeout: 15_000,
      });
      const message = JSON.parse(stdout.trim());
      assert.equal(message.error, undefined, entry);
      assert.equal(message.result?.manifest.package, "com.example.beta", entry);
      assert.equal(message.result?.manifest.versionCode, 42, entry);
    }
  } finally {
    await rm(artifact, { recursive: true, force: true });
  }
});

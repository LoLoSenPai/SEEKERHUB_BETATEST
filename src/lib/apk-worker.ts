import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { AndroidManifest } from "@devicefarmer/adbkit-apkreader";

export const APK_INSPECTION_TIMEOUT_MS = 10_000;

export async function readApkManifest(filePath: string, timeoutMs = APK_INSPECTION_TIMEOUT_MS) {
  // The literal fs access is intentional: Next's output-file tracer must ship this CJS worker
  // and its static require dependencies. No eval, TS loader, or writable generated script.
  const workerPath = join(process.cwd(), "src/lib/apk-manifest-worker.cjs");
  await access(workerPath);
  // Keep this native import outside the bundler: the tracer follows the CJS requires as
  // dependencies instead of treating the worker as an opaque asset. Importing definitions
  // does not parse anything; the workerData marker below is required to start inspection.
  const loadWorkerModule = () => import(/* webpackIgnore: true */ workerPath);
  if (process.platform === "win32") {
    const workerRequire = createRequire(workerPath);
    workerRequire(workerPath);
  } else {
    await loadWorkerModule();
  }
  return new Promise<{ manifest: AndroidManifest; hasV1SignatureFiles: boolean }>((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: { apkManifestWorker: true, filePath },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      execArgv: [],
    });
    let settled = false;
    const finish = (error?: Error, result?: { manifest: AndroidManifest; hasV1SignatureFiles: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().then(() => {
        if (error) reject(error);
        else if (result) resolve(result);
      }, reject);
    };
    const timer = setTimeout(() => finish(new Error("APK manifest inspection timed out.")), timeoutMs);
    worker.once("message", (message) => {
      if (message.error) finish(new Error(message.error));
      else if (message.result) finish(undefined, message.result);
      else finish(new Error("APK worker returned an invalid response."));
    });
    worker.once("error", (error) => finish(error));
    worker.once("exit", () => finish(new Error("APK manifest worker exited before completing inspection.")));
  });
}

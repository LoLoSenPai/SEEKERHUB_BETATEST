import { Worker } from "node:worker_threads";

const [entry, filePath] = process.argv.slice(2);
if (!entry || !filePath) throw new Error("Worker entry and APK fixture are required.");
const worker = new Worker(entry, {
  workerData: { apkManifestWorker: true, filePath },
  env: { ...process.env, NODE_PATH: "" },
  resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
});
let received = false;
const timer = setTimeout(() => {
  void worker.terminate();
  process.exitCode = 1;
  console.error("APK artifact worker timed out.");
}, 10_000);
worker.once("error", (error) => {
  clearTimeout(timer);
  console.error(error);
  process.exitCode = 1;
});
worker.once("exit", () => {
  clearTimeout(timer);
  if (!received) process.exitCode = 1;
});
worker.once("message", (value) => {
  received = true;
  clearTimeout(timer);
  console.log(JSON.stringify(value));
  void worker.terminate();
});

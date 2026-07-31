import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(rootDirectory, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

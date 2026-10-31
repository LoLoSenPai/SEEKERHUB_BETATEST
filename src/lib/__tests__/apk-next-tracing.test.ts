import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("APK finalize native worker deployment includes", () => {
  it("covers the complete installed worker dependency closure on the dynamic finalize route", async () => {
    const require = createRequire(import.meta.url);
    const picomatch = require("next/dist/compiled/picomatch");
    const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
    const trace = await nodeFileTrace(["src/lib/apk-manifest-worker.cjs"], { base: process.cwd(), processCwd: process.cwd() });
    expect([...trace.warnings]).toEqual([]);
    const includes = Object.entries(nextConfig.outputFileTracingIncludes ?? {})
      .filter(([route]) => picomatch(route)("/api/uploads/releases/[sessionId]/finalize"))
      .flatMap(([, patterns]) => patterns.map((pattern) => pattern.replace(/^\.\//, "")));
    expect(includes.length).toBeGreaterThan(0);
    for (const dependency of trace.fileList as Set<string>) {
      expect(includes.some((pattern) => picomatch(pattern)(dependency.replaceAll("\\", "/"))), dependency).toBe(true);
    }
  });
});

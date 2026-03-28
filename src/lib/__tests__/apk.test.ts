import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { assertApkName, calculateFileSha256, sanitizeObjectName } from "@/src/lib/apk";

describe("apk helpers", () => {
  it("normalizes object names", () => {
    expect(sanitizeObjectName("beta notes 0.8.3.apk")).toBe("beta-notes-0.8.3.apk");
  });

  it("rejects non-apk names", () => {
    expect(() => assertApkName("archive.zip")).toThrow();
  });

  it("computes a sha-256 checksum from a local file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seekerhub-apk-test-"));
    const filePath = join(dir, "fixture.apk");
    await writeFile(filePath, "fixture-content");

    const checksum = await calculateFileSha256(filePath);
    expect(checksum).toHaveLength(64);
  });
});

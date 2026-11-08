import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

describe("packaged brand images", () => {
  it.each([["seekerhub-icon.png", 512], ["favicon-32.png", 32], ["apple-touch-icon.png", 180]] as const)("serves a square PNG for %s", async (name, size) => {
    const image = await sharp(resolve("public/brand", name)).metadata();
    expect(image).toMatchObject({ format: "png", width: size, height: size, hasAlpha: true });
  });

  it("has valid ICO offsets and decodable frames at every tab size", async () => {
    const ico = await readFile(resolve("app/favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(4);
    let offset = 6 + 4 * 16;
    for (const [index, size] of [16, 32, 48, 256].entries()) {
      const entry = 6 + index * 16;
      expect(ico[entry] || 256).toBe(size);
      expect(ico[entry + 1] || 256).toBe(size);
      expect(ico.readUInt32LE(entry + 12)).toBe(offset);
      const length = ico.readUInt32LE(entry + 8);
      const frame = ico.subarray(offset, offset + length);
      expect(await sharp(frame).metadata()).toMatchObject({ format: "png", width: size, height: size, hasAlpha: true });
      if (size === 32) expect(frame.equals(await readFile(resolve("public/brand/favicon-32.png")))).toBe(true);
      offset += length;
    }
    expect(offset).toBe(ico.length);
  });
});

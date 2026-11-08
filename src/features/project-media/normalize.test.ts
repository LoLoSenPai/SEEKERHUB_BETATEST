import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeProjectMedia } from "./normalize";

async function raster(width: number, height: number, format: "png" | "jpeg" | "webp" = "png") {
  return sharp({ create: { width, height, channels: 3, background: "#447766" } }).toFormat(format).toBuffer();
}

describe("project media normalization with real sharp", () => {
  it.each(["jpeg", "png", "webp"] as const)("decodes %s to a bounded metadata-free icon", async (format) => {
    const source = await sharp(await raster(800, 600, format)).withExif({ IFD0: { Artist: "private-user" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 0/1" } }).toFormat(format).toBuffer();
    const result = await normalizeProjectMedia(source, "ICON");
    const metadata = await sharp(result.data).metadata();
    expect(result).toMatchObject({ width: 512, height: 512 });
    expect(result.data.length).toBeLessThanOrEqual(256 * 1024);
    expect(metadata).toMatchObject({ format: "webp" });
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.xmp).toBeUndefined();
  });
  it("crops banners and preserves screenshot aspect ratio without enlarging", async () => {
    expect(await normalizeProjectMedia(await raster(100, 100), "BANNER")).toMatchObject({ width: 1600, height: 900 });
    const image = await normalizeProjectMedia(await raster(1200, 2400), "SCREENSHOT");
    expect(image).toMatchObject({ width: 960, height: 1920 }); expect(image.data.length).toBeLessThanOrEqual(1024 * 1024);
    expect(await normalizeProjectMedia(await raster(200, 300), "SCREENSHOT")).toMatchObject({ width: 200, height: 300 });
  });
  it("rejects SVG, GIF, corrupt inputs, oversize bytes and excessive dimensions", async () => {
    for (const input of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), Buffer.from("GIF89a"), Buffer.from([0xff, 0xd8, 0xff, 0]), Buffer.alloc(3 * 1024 * 1024 + 1)]) {
      await expect(normalizeProjectMedia(input, "ICON")).rejects.toMatchObject({ status: expect.any(Number) });
    }
    await expect(normalizeProjectMedia(await raster(4097, 10), "ICON")).rejects.toMatchObject({ code: "INVALID_MEDIA_IMAGE" });
    await expect(normalizeProjectMedia(await raster(4096, 4096), "ICON")).rejects.toMatchObject({ code: "INVALID_MEDIA_IMAGE" });
  });
  it("rejects APNG animation control and animated WebP even before decode", async () => {
    const png = await raster(10, 10);
    const acTL = Buffer.alloc(20); acTL.writeUInt32BE(8, 0); acTL.write("acTL", 4); acTL.writeUInt32BE(2, 8);
    await expect(normalizeProjectMedia(Buffer.concat([png.subarray(0, 33), acTL, png.subarray(33)]), "ICON")).rejects.toMatchObject({ code: "INVALID_MEDIA_IMAGE" });
    const red = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).raw().toBuffer();
    const blue = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).raw().toBuffer();
    const animated = Buffer.concat([red, blue]);
    const webp = await sharp(animated, { raw: { width: 10, height: 20, channels: 3, pageHeight: 10 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    await expect(normalizeProjectMedia(webp, "ICON")).rejects.toMatchObject({ code: "INVALID_MEDIA_IMAGE" });
  });
});

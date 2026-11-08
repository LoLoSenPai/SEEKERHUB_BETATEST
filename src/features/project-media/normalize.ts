import sharp from "sharp";
import { AppError } from "@/src/lib/errors";
import type { ProjectMediaKind } from "./types";
import { MAX_MEDIA_INPUT_BYTES } from "./validation";

function assertStaticRaster(input: Buffer) {
  if (input.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return;
  if (input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    // libvips can expose only APNG's first frame. Reject the animation control
    // chunk ourselves instead of mistaking a successful first-frame decode for static.
    for (let offset = 8; offset + 12 <= input.length;) {
      const size = input.readUInt32BE(offset);
      const type = input.toString("ascii", offset + 4, offset + 8);
      if (type === "acTL" || type === "fcTL" || type === "fdAT") throw new Error("Animated PNG");
      if (offset + 12 + size > input.length) throw new Error("Invalid PNG chunk");
      offset += 12 + size;
    }
    return;
  }
  if (input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP") {
    for (let offset = 12; offset + 8 <= input.length;) {
      const type = input.toString("ascii", offset, offset + 4);
      const size = input.readUInt32LE(offset + 4);
      if (type === "ANIM" || type === "ANMF" || (type === "VP8X" && size >= 1 && (input[offset + 8] & 2))) throw new Error("Animated WebP");
      if (offset + 8 + size > input.length) throw new Error("Invalid WebP chunk");
      offset += 8 + size + (size % 2);
    }
    return;
  }
  throw new Error("Unsupported raster signature");
}

export async function normalizeProjectMedia(input: Buffer, kind: ProjectMediaKind) {
  if (!input.length || input.length > MAX_MEDIA_INPUT_BYTES) {
    throw new AppError("Images must be at most 3 MiB.", 413, "MEDIA_TOO_LARGE");
  }
  try {
    assertStaticRaster(input);
    const options = { limitInputPixels: 16_000_000, failOn: "warning" as const, animated: true };
    const metadata = await sharp(input, options).metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) ||
        !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 ||
        metadata.width * metadata.height > 16_000_000 || (metadata.pages ?? 1) !== 1 || metadata.loop !== undefined) {
      throw new Error("Unsupported image");
    }
    const maxBytes = kind === "ICON" ? 256 * 1024 : 1024 * 1024;
    for (const quality of [85, 72, 58, 42]) {
      let pipeline = sharp(input, options).rotate().toColourspace("srgb");
      if (kind === "ICON") pipeline = pipeline.resize(512, 512, { fit: "cover" });
      else if (kind === "BANNER") pipeline = pipeline.resize(1600, 900, { fit: "cover" });
      else pipeline = pipeline.resize(1920, 1920, { fit: "inside", withoutEnlargement: true });
      // No keepMetadata/withMetadata: EXIF, GPS, XMP and ICC are intentionally discarded.
      const { data, info } = await pipeline.webp({ quality, effort: 4 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
      if (data.length <= maxBytes) return { data, width: info.width, height: info.height };
    }
    throw new AppError("Image remains too large after optimization. Choose a simpler image.", 413, "MEDIA_OUTPUT_TOO_LARGE");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Use a valid, static JPEG, PNG or WebP image, at most 4096 px and 16 MP.", 400, "INVALID_MEDIA_IMAGE");
  }
}

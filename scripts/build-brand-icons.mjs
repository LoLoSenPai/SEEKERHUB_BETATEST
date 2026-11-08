import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = fileURLToPath(new URL("../assets/brand/seekerhub-icon-source.png", import.meta.url));
const publicDirectory = new URL("../public/brand/", import.meta.url);
const metadata = await sharp(source).metadata();
if (!metadata.width || metadata.width !== metadata.height) throw new Error("The brand source must be square.");
await mkdir(publicDirectory, { recursive: true });

async function png(size) {
  return sharp(source).resize(size, size).ensureAlpha().png({ compressionLevel: 9 }).toBuffer();
}

for (const [name, size] of [["seekerhub-icon.png", 512], ["favicon-32.png", 32], ["apple-touch-icon.png", 180]]) {
  const bytes = await png(size);
  await writeFile(new URL(name, publicDirectory), bytes);
  console.log(`${name}: ${size}x${size}, ${bytes.length} bytes`);
}

// Next's ICO decoder requires RGBA PNG frames, including for opaque artwork.
// Include small tab sizes and a high-DPI frame.
const sizes = [16, 32, 48, 256];
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
const frames = [];
let offset = header.length;
for (const [index, size] of sizes.entries()) {
  const frame = await png(size);
  const entry = 6 + index * 16;
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  frames.push(frame);
  offset += frame.length;
}
await writeFile(new URL("../app/favicon.ico", import.meta.url), Buffer.concat([header, ...frames]));
console.log(`favicon.ico: ${sizes.join(", ")}px frames, ${offset} bytes`);

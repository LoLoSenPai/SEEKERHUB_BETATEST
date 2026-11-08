import { z } from "zod";
import { AppError } from "@/src/lib/errors";

export const MAX_MEDIA_INPUT_BYTES = 3 * 1024 * 1024;
export const MAX_PROJECT_MEDIA_BYTES = 8 * 1024 * 1024;
export const mediaKindSchema = z.enum(["ICON", "BANNER", "SCREENSHOT"]);
export const mediaIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const uploadMediaSchema = z.object({
  projectId: mediaIdSchema,
  kind: mediaKindSchema,
  replaceId: mediaIdSchema.optional(),
}).strict();
export const reorderMediaSchema = z.object({
  projectId: mediaIdSchema,
  ids: z.array(mediaIdSchema).max(5).refine((ids) => new Set(ids).size === ids.length),
}).strict();

// Never return Zod issues: input values and parser internals are not API data.
export function parseMediaInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("Invalid media request.", 400, "INVALID_MEDIA_REQUEST");
  return result.data;
}

export async function readBoundedBody(request: Request, maxBytes: number) {
  const lengthHeader = request.headers.get("content-length");
  if (!lengthHeader || !/^\d+$/.test(lengthHeader)) {
    throw new AppError("Content-Length is required.", 411, "CONTENT_LENGTH_REQUIRED");
  }
  const expected = Number(lengthHeader);
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > maxBytes) {
    throw new AppError("File or request is too large.", 413, "MEDIA_TOO_LARGE");
  }
  if (!request.body) throw new AppError("An image is required.", 400, "MEDIA_REQUIRED");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const timeout = setTimeout(() => { void reader.cancel().catch(() => undefined); }, 15_000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes || total > expected) {
        await reader.cancel();
        throw new AppError("File or request is too large.", 413, "MEDIA_TOO_LARGE");
      }
      chunks.push(value);
    }
    if (total !== expected) throw new AppError("Incomplete request body.", 400, "INVALID_MEDIA_BODY");
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

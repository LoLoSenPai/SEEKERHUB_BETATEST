import { describe, expect, it } from "vitest";
import { MAX_MEDIA_INPUT_BYTES, parseMediaInput, readBoundedBody, reorderMediaSchema, uploadMediaSchema } from "./validation";

function request(body: Uint8Array, length?: string) {
  return new Request("https://app.example/api/project-media", { method: "POST", body: Buffer.from(body), headers: length === undefined ? {} : { "content-length": length } });
}

describe("bounded media input", () => {
  it("rejects unknown remote URL inputs and sanitizes validation errors", () => {
    expect(() => parseMediaInput(uploadMediaSchema, { projectId: "p", kind: "ICON", url: "https://secret.example/image" })).toThrow("Invalid media request.");
    try { parseMediaInput(uploadMediaSchema, { projectId: "../secret", kind: "SVG" }); } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_MEDIA_REQUEST", status: 400 });
      expect(error).not.toHaveProperty("issues");
    }
    expect(() => parseMediaInput(reorderMediaSchema, { projectId: "p", ids: ["a", "a"] })).toThrow();
  });
  it("requires a known content length before reading", async () => {
    await expect(readBoundedBody(request(Buffer.from("a")), MAX_MEDIA_INPUT_BYTES)).rejects.toMatchObject({ status: 411 });
    await expect(readBoundedBody(request(Buffer.from("a"), String(MAX_MEDIA_INPUT_BYTES + 1)), MAX_MEDIA_INPUT_BYTES)).rejects.toMatchObject({ status: 413 });
  });
  it("caps actual streamed bytes independently of the declared size", async () => {
    await expect(readBoundedBody(request(Buffer.alloc(20), "1"), 10)).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedBody(request(Buffer.alloc(1), "2"), 10)).rejects.toMatchObject({ code: "INVALID_MEDIA_BODY" });
    await expect(readBoundedBody(request(Buffer.from("abc"), "3"), 10)).resolves.toEqual(Buffer.from("abc"));
  });
});

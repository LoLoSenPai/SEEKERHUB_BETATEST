import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn() }));
vi.mock("@/src/lib/storage/s3", () => ({ storageClient: { send: mocks.send }, getBucketName: () => "existing-private-bucket" }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
import { createSignedMediaUrl, uploadNormalizedMedia } from "@/src/lib/storage/project-media";

beforeEach(() => vi.resetAllMocks());
describe("private media S3 transport", () => {
  it("uses immutable bounded PUT with inline WebP, without any public ACL", async () => {
    await uploadNormalizedMedia("projects/p/media/id.webp", Buffer.from("webp"));
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({ Bucket: "existing-private-bucket", Key: "projects/p/media/id.webp", ContentType: "image/webp", ContentDisposition: "inline", ContentLength: 4, CacheControl: "private, no-store", IfNoneMatch: "*" });
    expect(mocks.send.mock.calls[0][0].input).not.toHaveProperty("ACL");
    await expect(uploadNormalizedMedia("projects/p/inspected-apks/id/release.apk", Buffer.from("webp"))).rejects.toThrow("Invalid media storage key");
  });
  it("never uses APK attachment responses and signs only short-lived inline image GETs", async () => {
    await createSignedMediaUrl("projects/p/media/id.webp");
    const [, command, options] = mocks.sign.mock.calls[0];
    expect(command.input).toEqual({ Bucket: "existing-private-bucket", Key: "projects/p/media/id.webp", ResponseContentType: "image/webp", ResponseContentDisposition: "inline", ResponseCacheControl: "private, no-store" });
    expect(options).toEqual({ expiresIn: 60 });
  });
});

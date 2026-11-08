import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rate: vi.fn(), project: vi.fn(), normalize: vi.fn(), store: vi.fn(), query: vi.fn() }));
vi.mock("@/src/lib/env", () => ({ getServerEnv: () => ({ BETTER_AUTH_URL: "https://app.example" }) }));
vi.mock("@/src/lib/db", () => ({ prisma: { appProject: { findFirst: mocks.project } } }));
vi.mock("@/src/lib/session", () => ({ requireBuilderApiSession: mocks.session }));
vi.mock("@/src/lib/rate-limit", () => ({ consumeRateLimit: mocks.rate }));
vi.mock("./normalize", () => ({ normalizeProjectMedia: mocks.normalize }));
vi.mock("./service", () => ({ storeProjectMedia: mocks.store, deleteProjectMedia: vi.fn(), reorderProjectMedia: vi.fn() }));
vi.mock("./queries", () => ({ getProjectMedia: mocks.query }));
import { POST } from "@/app/api/project-media/route";
import { AppError } from "@/src/lib/errors";

function upload(headers: Record<string, string> = {}) {
  return new Request("https://app.example/api/project-media?projectId=p&kind=ICON", { method: "POST", body: Buffer.from("abc"), headers: { origin: "https://app.example", "content-length": "3", "content-type": "image/png", ...headers } });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: "owner" } }); mocks.project.mockResolvedValue({ id: "p" });
  mocks.normalize.mockResolvedValue({ data: Buffer.from("webp"), width: 512, height: 512 }); mocks.query.mockResolvedValue([]);
});

describe("project media API authorization and upload boundary", () => {
  it("rejects absent/wrong origins and cross-site requests before auth or body decode", async () => {
    for (const headers of [{ origin: "" }, { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
      expect((await POST(upload(headers))).status).toBe(403);
    }
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.normalize).not.toHaveBeenCalled();
  });
  it("requires builder auth and ownership even with valid image headers", async () => {
    mocks.session.mockRejectedValueOnce(new AppError("Authentication required.", 401));
    expect((await POST(upload())).status).toBe(401);
    mocks.project.mockResolvedValueOnce(null);
    expect((await POST(upload())).status).toBe(404);
    expect(mocks.normalize).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled();
  });
  it("enforces rate limit before image decode", async () => {
    mocks.rate.mockRejectedValueOnce(new AppError("Too many requests.", 429));
    expect((await POST(upload())).status).toBe(429); expect(mocks.normalize).not.toHaveBeenCalled();
  });
  it("rejects oversized declared and streamed bodies before sharp", async () => {
    expect((await POST(upload({ "content-length": String(4 * 1024 * 1024) }))).status).toBe(413);
    expect((await POST(upload({ "content-length": "1" }))).status).toBe(413);
    expect((await POST(upload({ "content-type": "image/svg+xml" }))).status).toBe(415);
    expect(mocks.normalize).not.toHaveBeenCalled();
  });
  it("returns sanitized errors and no-store DTO responses", async () => {
    const malformed = await POST(new Request("https://app.example/api/project-media?projectId=bad%2Fid&kind=SVG", { method: "POST" }));
    expect(await malformed.json()).toEqual({ error: "Invalid media request.", code: "INVALID_MEDIA_REQUEST" });
    const response = await POST(upload());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.store).toHaveBeenCalledWith({ userId: "owner", projectId: "p", kind: "ICON", data: Buffer.from("webp"), width: 512, height: 512 });
  });
});

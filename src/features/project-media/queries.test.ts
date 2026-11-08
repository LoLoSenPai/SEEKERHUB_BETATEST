import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), sign: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/db", () => ({ prisma: { projectMedia: { findMany: mocks.findMany } } }));
vi.mock("@/src/lib/storage/project-media", () => ({ createSignedMediaUrl: mocks.sign }));
import { getProjectMedia } from "./queries";

describe("authorized caller media DTO", () => {
  it("filters deleted projects and unfinished media, serializes only the contract", async () => {
    mocks.findMany.mockResolvedValue([{ id: "m", kind: "ICON", storageKey: "private-key", width: 512, height: 512, position: 0 }]);
    mocks.sign.mockResolvedValue("https://storage.example/signed-inline.webp");
    const items = await getProjectMedia("p");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p", status: "READY", deletedAt: null, project: { deletedAt: null } }, take: 7 }));
    expect(items).toEqual([{ id: "m", kind: "ICON", width: 512, height: 512, position: 0, url: "https://storage.example/signed-inline.webp" }]);
    expect(JSON.stringify(items)).not.toContain("private-key");
  });
});

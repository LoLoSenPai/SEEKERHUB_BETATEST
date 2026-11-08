import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessibleReleasesForUser: vi.fn(), getTesterIdentity: vi.fn(), getTesterRelease: vi.fn(),
  getInvitePreview: vi.fn(), getProjectMedia: vi.fn(),
}));
vi.mock("@/src/features/projects/queries", () => mocks);
vi.mock("@/src/features/project-media/queries", () => ({ getProjectMedia: mocks.getProjectMedia }));
vi.mock("@/src/lib/session", () => ({ requireTesterSession: async () => ({ user: { id: "tester", isAnonymous: true } }), getSession: async () => null }));
vi.mock("@/src/lib/db", () => ({ prisma: { builderProfile: { findUnique: async () => null } } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import TesterDashboardPage from "@/app/(tester)/tester/page";
import TesterReleaseDetailPage from "@/app/(tester)/tester/releases/[releaseId]/page";
import InvitePage from "@/app/invite/[token]/page";

describe("private project media authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getTesterIdentity.mockResolvedValue(null); mocks.getProjectMedia.mockResolvedValue([]); });

  it("loads library media only for projects whose access still permits metadata", async () => {
    mocks.getAccessibleReleasesForUser.mockResolvedValue([{ id: "allowed", projectId: "a", project: { name: "App" } }, { id: "revoked", projectId: "b" }]);
    mocks.getTesterRelease.mockImplementation(async (id: string) => ({ decision: { canViewMetadata: id === "allowed", canDownload: true, reasons: [] } }));
    await TesterDashboardPage();
    expect(mocks.getProjectMedia).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("does not load release media when access is denied", async () => {
    mocks.getTesterRelease.mockResolvedValue({ decision: { canViewMetadata: false } });
    await expect(TesterReleaseDetailPage({ params: Promise.resolve({ releaseId: "revoked" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.getProjectMedia).not.toHaveBeenCalled();
  });

  it("does not load media for an unavailable invitation", async () => {
    mocks.getInvitePreview.mockResolvedValue(null);
    await InvitePage({ params: Promise.resolve({ token: "invalid" }) });
    expect(mocks.getProjectMedia).not.toHaveBeenCalled();
  });

  it("loads media after a valid invitation preview", async () => {
    mocks.getInvitePreview.mockResolvedValue({ project: { id: "app", name: "App", releases: [] }, release: null });
    await InvitePage({ params: Promise.resolve({ token: "valid" }) });
    expect(mocks.getProjectMedia).toHaveBeenCalledExactlyOnceWith("app");
  });

  it.each([
    { policies: [true], published: true, combined: true },
    { policies: [true, false], published: true, combined: false },
    { policies: [false], published: true, combined: false },
    { policies: [true], published: false, combined: false },
  ])("only combines SGT sign-in when the published invitation requires it: $policies / $published", async ({ policies, published, combined }) => {
    const policy = (required: boolean) => ({ requireLinkedWallet: false, requireVerifiedSeeker: required, _count: { walletEntries: 0 } });
    mocks.getInvitePreview.mockResolvedValue({
      project: { id: "app", name: "App", releases: policies.map((required) => ({ accessPolicy: policy(required) })) },
      release: published ? null : { versionName: "1", status: "DRAFT", accessPolicy: policy(true) },
    });
    const page = await InvitePage({ params: Promise.resolve({ token: "valid" }) });
    const columns = page.props.children[1].props.children;
    const claimCard = columns[1].props.children.props.children;
    expect(claimCard.props.combinedSeekerCheck).toBe(combined);
  });
});

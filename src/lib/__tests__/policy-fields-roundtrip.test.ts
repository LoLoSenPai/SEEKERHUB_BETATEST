import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const formState = vi.hoisted(() => ({ state: { status: "idle", message: "" }, pending: false }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useActionState: () => [formState.state, () => undefined, formState.pending],
}));
vi.mock("@/src/features/releases/actions", () => ({ updateReleasePolicyAction: vi.fn() }));
import { AccessPolicyFields, ReleasePolicyEditor } from "@/src/features/releases/access-policy-fields";

beforeEach(() => { formState.state = { status: "idle", message: "" }; formState.pending = false; });

describe("native policy fields", () => {
  it("renders group + SGT + allowlist together without empty hidden replacements", () => {
    const html = renderToStaticMarkup(createElement(AccessPolicyFields, { groups: [{ id: "qa", name: "QA" }], defaults: {
      requireInviteAcceptance: true, testerGroupId: "qa", requireLinkedWallet: true, requireVerifiedSeeker: true,
      requireSolanaMobile: true, allowPreviousReleases: true, walletAllowlist: "11111111111111111111111111111111",
    } }));
    expect(html).toContain('name="testerGroupId"');
    expect(html).toContain('value="qa" selected=""');
    expect(html).toContain('name="walletAllowlist"');
    expect(html).toContain('>11111111111111111111111111111111</textarea>');
    expect(html).not.toMatch(/type="hidden" name="(?:testerGroupId|walletAllowlist)"/);
    for (const name of ["requireInviteAcceptance", "requireVerifiedSeeker", "requireSolanaMobile", "allowPreviousReleases"]) {
      expect(html).toMatch(new RegExp(`name="${name}"[^>]*checked=""`));
    }
    expect(html).toMatch(/name="accessPreset"[^>]*checked=""[^>]*value="custom"/);
  });
  it("retains a group even if the supplied options no longer contain it", () => {
    const html = renderToStaticMarkup(createElement(AccessPolicyFields, { groups: [], defaults: { testerGroupId: "existing" } }));
    expect(html).toContain('value="existing" selected=""');
  });
  it.each(["error", "success"])("shows %s form state and submits through the shared Button", (status) => {
    formState.state = { status, message: `${status} result` };
    formState.pending = true;
    const html = renderToStaticMarkup(createElement(ReleasePolicyEditor, { groups: [], releaseId: "release", projectSlug: "app" }));
    expect(html).toContain(`role="${status === "error" ? "alert" : "status"}"`);
    expect(html).toContain(`${status} result`);
    expect(html).toContain('name="releaseId" value="release"');
    expect(html).toContain('name="projectSlug" value="app"');
    expect(html).toContain("text-primary-foreground");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Saving\.\.\.<\/button>/);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { BrandIcon } from "./brand-icon";
import { BRAND_ICON_PATH } from "@/src/lib/brand";

vi.mock("@/src/lib/session", () => ({ getSession: async () => null }));
vi.mock("@/src/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/src/components/layout/account-menu", () => ({ AccountMenu: () => null }));
vi.mock("@/src/components/layout/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));

describe("brand surfaces", () => {
  it("uses a shared decorative icon with stable square dimensions", () => {
    expect(BrandIcon({ size: 28 }).props).toMatchObject({ src: BRAND_ICON_PATH, alt: "", "aria-hidden": "true", width: 28, height: 28 });
  });

  it("replaces the homepage placeholders and hero S without changing the entry URL", async () => {
    const markup = renderToStaticMarkup(await Home());
    expect(markup).toContain(encodeURIComponent(BRAND_ICON_PATH));
    expect(markup).not.toContain("lucide-square");
    expect(markup).not.toMatch(/class="home-art-mark">S/);
    expect(markup).toMatch(/class="home-art-mark"><img[^>]+data-nimg="fill"/);
    expect(markup).toContain('href="/sign-in?returnTo=%2Fdashboard"');
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
  });

  it.each(["builder", "tester"] as const)("uses the asset in both desktop and mobile %s workspace headers", (kind) => {
    const markup = renderToStaticMarkup(DashboardFrame({ kind, currentPath: kind === "builder" ? "/builder" : "/tester", title: "Apps", subtitle: "", children: "Content" }));
    expect(markup).not.toContain("lucide-square");
    expect(markup).toContain(encodeURIComponent(BRAND_ICON_PATH));
    expect(markup.match(/alt=""/g)).toHaveLength(2);
    expect(markup.match(/href="\/dashboard"/g)).toHaveLength(2);
  });
});

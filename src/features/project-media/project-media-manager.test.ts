import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMediaManager } from "./project-media-manager";

const mocks = vi.hoisted(() => ({ client: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useSyncExternalStore: (
    subscribe: (callback: () => void) => () => void, getSnapshot: () => boolean, getServerSnapshot: () => boolean,
  ) => mocks.client ? getSnapshot() : original.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) };
});

beforeEach(() => { mocks.client = false; });

function render(withMedia = false) {
  return renderToStaticMarkup(createElement(ProjectMediaManager, {
    projectId: "project",
    initialMedia: withMedia ? [{ id: "icon", kind: "ICON", url: "https://storage.example/icon.webp", width: 512, height: 512, position: 0 }] : [],
  }));
}

describe("project media hydration boundary", () => {
  it.each([false, true])("disables every upload and replacement input during SSR (existing media: %s)", (withMedia) => {
    const markup = render(withMedia);
    const inputs = markup.match(/<input\b[^>]*type="file"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(3);
    for (const input of inputs) expect(input).toContain('disabled=""');
    for (const button of markup.match(/<button\b[^>]*>/g) ?? []) expect(button).toContain('disabled=""');
    expect(markup).toMatch(/<fieldset\b[^>]*disabled=""/);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Preparing image controls...");
  });

  it("enables idle inputs and refresh after the client hydration snapshot", () => {
    mocks.client = true;
    const markup = render(true);
    for (const input of markup.match(/<input\b[^>]*type="file"[^>]*>/g) ?? []) expect(input).not.toContain("disabled");
    expect(markup).not.toMatch(/<fieldset\b[^>]*disabled/);
    expect(markup).toContain('aria-busy="false"');
    expect(markup).not.toContain("Preparing image controls...");
  });
});

import { describe, expect, it } from "vitest";
import { latestApps } from "./latest-apps";

describe("latestApps", () => {
  it("keeps the first accessible release for each project in newest-first order", () => {
    const releases = [{ projectId: "a", id: "new" }, { projectId: "b", id: "other" }, { projectId: "a", id: "old" }];
    expect(latestApps(releases)).toEqual(releases.slice(0, 2));
  });
  it("handles an empty library", () => expect(latestApps([])).toEqual([]));
});

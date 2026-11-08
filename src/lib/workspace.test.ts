import { describe, expect, it } from "vitest";
import { dashboardDestination, needsAccountEmail, workspacePreference } from "./workspace";

describe("workspace navigation", () => {
  const defaults = { isGuest: false, builderStatus: null, hasTestingActivity: false, preference: null } as const;
  it("welcomes a new account without enrolling a builder", () => expect(dashboardDestination(defaults)).toBeNull());
  it("keeps guests in testing regardless of preference", () => expect(dashboardDestination({ ...defaults, isGuest: true, preference: "publishing" })).toBe("/tester"));
  it("opens existing publishing workspaces by default", () => expect(dashboardDestination({ ...defaults, builderStatus: "ACTIVE" })).toBe("/builder"));
  it("honors the testing choice even for builders", () => expect(dashboardDestination({ ...defaults, builderStatus: "ACTIVE", preference: "testing" })).toBe("/tester"));
  it("keeps invitation users in their library by default", () => expect(dashboardDestination({ ...defaults, hasTestingActivity: true })).toBe("/tester"));
  it("routes publishing choices to the guarded builder entry", () => expect(dashboardDestination({ ...defaults, preference: "publishing" })).toBe("/builder"));
  it("does not send suspended builders into a redirect loop", () => expect(dashboardDestination({ ...defaults, builderStatus: "SUSPENDED", preference: "publishing" })).toBe("/tester"));
  it("scopes the remembered choice to the current account", () => {
    expect(workspacePreference("testing:alice", "alice")).toBe("testing");
    expect(workspacePreference("publishing:alice", "alice")).toBe("publishing");
    for (const value of [undefined, "testing:bob", "admin:alice", "publishing:alice:extra", "/builder"]) expect(workspacePreference(value, "alice")).toBeNull();
  });
  it("recognizes synthetic guest and wallet emails", () => {
    expect(needsAccountEmail("wallet-abc@seekerhub.local")).toBe(true);
    expect(needsAccountEmail("guest@SEEKERHUB.LOCAL")).toBe(true);
    expect(needsAccountEmail("test@example.com")).toBe(false);
  });
});

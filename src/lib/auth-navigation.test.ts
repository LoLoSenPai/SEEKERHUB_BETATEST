import { describe, expect, it } from "vitest";
import { getAuthReturnTo, getEmailAuthMethod } from "./auth-navigation";
import { safeReturnTo } from "./redirect";

describe("auth return navigation", () => {
  it("defaults to the unified dashboard", () => {
    expect(getAuthReturnTo()).toBe("/dashboard");
    expect(getAuthReturnTo({ intent: "unknown" })).toBe("/dashboard");
  });

  it.each([["builder", "/builder"], ["tester", "/tester"]])("preserves legacy %s intent destinations", (intent, expected) => {
    expect(getAuthReturnTo({ intent })).toBe(expected);
    expect(getAuthReturnTo({ intent, returnTo: "https://example.com" })).toBe(expected);
  });

  it.each([undefined, "builder", "tester"])("prefers an explicit safe returnTo over intent %s", (intent) => {
    expect(getAuthReturnTo({ intent, returnTo: "/invite/token?source=email#claim" })).toBe("/invite/token?source=email#claim");
  });

  it.each([
    "", "https://example.com", "javascript:alert(1)", "//example.com", "///example.com",
    "\\example.com", "/\\example.com", "/\n/example.com", "/\t/example.com", "/\r/example.com",
    "/%2f/example.com", "/%2F%2Fexample.com", "/%5cexample.com", "/%252f%252fexample.com",
    "/%00/example.com", "/%0a/example.com", "/%7f/example.com", "/a/..//example.com",
  ])("rejects unsafe returnTo %j", (returnTo) => {
    expect(getAuthReturnTo({ returnTo })).toBe("/dashboard");
  });

  it("rejects ambiguous repeated parameters", () => {
    expect(getAuthReturnTo({ returnTo: ["/builder", "/tester"] })).toBe("/dashboard");
    expect(getAuthReturnTo({ intent: ["builder", "tester"] })).toBe("/dashboard");
  });

  it.each(["/sign-in", "/sign-up?returnTo=/sign-in", "/a/../sign-in", "/sign-in/"])("avoids authentication redirect loops at %s", (returnTo) => {
    expect(getAuthReturnTo({ returnTo })).toBe("/dashboard");
  });

  it.each([["builder", "/builder"], ["tester", "/tester"]])("keeps legacy %s fallback when rejecting auth loops", (intent, expected) => {
    expect(getAuthReturnTo({ intent, returnTo: "/a/%2e%2e/sign-in?returnTo=%2Ftester" })).toBe(expected);
    expect(getAuthReturnTo({ intent, returnTo: "/sign-up" })).toBe(expected);
  });

  it("keeps invite callbacks while rejecting an unsafe nested onboarding destination", () => {
    const returnTo = "/builder/onboarding?returnTo=%2F%09%2Fevil.example";
    const accepted = getAuthReturnTo({ returnTo });
    expect(accepted).toBe(returnTo);
    const nested = new URL(accepted, "https://seekerhub.example").searchParams.get("returnTo");
    expect(safeReturnTo(nested, "/builder")).toBe("/builder");
    expect(getAuthReturnTo({ returnTo: "/invite/private-token?returnTo=%2Ftester" })).toBe("/invite/private-token?returnTo=%2Ftester");
  });

  it("keeps encoded query values and safe internal paths", () => {
    expect(getAuthReturnTo({ returnTo: "/builder/onboarding?returnTo=%2Fbuilder%2Fprojects" })).toBe("/builder/onboarding?returnTo=%2Fbuilder%2Fprojects");
    expect(getAuthReturnTo({ returnTo: "/tester/apps/../account" })).toBe("/tester/account");
  });
});

describe("email auth method", () => {
  it("defaults every sign-in to magic link", () => {
    expect(getEmailAuthMethod("sign-in")).toBe("magic");
    expect(getEmailAuthMethod("sign-in", "builder")).toBe("magic");
    expect(getEmailAuthMethod("sign-in", "tester")).toBe("magic");
  });

  it("accepts the explicit existing-account password path", () => {
    expect(getEmailAuthMethod("sign-in", "password")).toBe("password");
  });

  it("always uses email and password for registration", () => {
    expect(getEmailAuthMethod("sign-up")).toBe("password");
    expect(getEmailAuthMethod("sign-up", "magic")).toBe("password");
  });
});

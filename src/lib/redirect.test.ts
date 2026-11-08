import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./redirect";

describe("safeReturnTo", () => {
  it.each([undefined, null, "", "https://evil.example", "javascript:alert(1)", "//evil.example", "///evil.example", "\\evil.example", "/\\evil.example"])("rejects non-local destinations %j", (value) => {
    expect(safeReturnTo(value, "/builder")).toBe("/builder");
  });

  it.each([...Array.from({ length: 33 }, (_, index) => index), 127])("rejects raw control or whitespace character %i", (code) => {
    expect(safeReturnTo(`/${String.fromCharCode(code)}/evil.example`, "/builder")).toBe("/builder");
  });

  it.each([
    "/%2f/evil.example", "/%2F%2Fevil.example", "/%5cevil.example", "/%5C/evil.example",
    "/%252f%252fevil.example", "/%255cevil.example", "/%25252f/evil.example",
    "/%00/evil.example", "/%09/evil.example", "/%0a/evil.example", "/%0D/evil.example",
    "/%1f/evil.example", "/%7F/evil.example",
  ])("rejects encoded separators and controls %j", (value) => {
    expect(safeReturnTo(value, "/builder")).toBe("/builder");
  });

  it.each([
    "/a/..//evil.example", "/a/../..//evil.example", "/a/%2e%2e//evil.example",
    "/a/.%2e//evil.example", "/a/%2E.//evil.example", "/a/b/../../\/evil.example",
  ])("rejects normalized authority-like paths %j", (value) => {
    expect(safeReturnTo(value, "/builder")).toBe("/builder");
  });

  it.each([
    ["/tester/releases/abc", "/tester/releases/abc"],
    ["/invite/token?source=email#claim", "/invite/token?source=email#claim"],
    ["/tester/releases/../account?tab=profile#email", "/tester/account?tab=profile#email"],
    ["/builder/%2e%2e/tester", "/tester"],
    ["/a/./b/../../dashboard", "/dashboard"],
    ["/builder/onboarding?returnTo=%2Fbuilder%2Fprojects", "/builder/onboarding?returnTo=%2Fbuilder%2Fprojects"],
  ])("preserves or normalizes safe destination %j", (value, expected) => {
    expect(safeReturnTo(value, "/builder")).toBe(expected);
    expect(new URL(expected, "https://seekerhub.example").origin).toBe("https://seekerhub.example");
  });

  it("rejects the onboarding attack when the nested returnTo is consumed", () => {
    const onboarding = "/builder/onboarding?returnTo=%2F%09%2Fevil.example";
    const accepted = safeReturnTo(onboarding, "/dashboard");
    const nested = new URL(accepted, "https://seekerhub.example").searchParams.get("returnTo");
    expect(safeReturnTo(nested, "/builder")).toBe("/builder");
  });

  it("leaves auth-loop policy to the auth helper", () => {
    expect(safeReturnTo("/sign-in?returnTo=%2Ftester", "/builder")).toBe("/sign-in?returnTo=%2Ftester");
  });
});

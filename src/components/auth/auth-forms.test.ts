import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EmailAuthForm } from "./email-auth-form";
import { AddAccountEmailForm } from "./add-account-email-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/src/lib/auth-client", () => ({ authClient: {} }));

describe("unified email auth UI", () => {
  it.each([undefined, "builder", "tester"] as const)("keeps the same default methods for legacy intent %s", (intent) => {
    const markup = renderToStaticMarkup(createElement(EmailAuthForm, { mode: "sign-in", intent, returnTo: "/tester" }));
    expect(markup).toContain("Send magic link");
    expect(markup).toContain("Use a password instead");
    expect(markup).not.toContain('name="password"');
    expect(markup).not.toMatch(/Builder|Tester|intent=/);
    expect(markup).toContain('/sign-up?returnTo=%2Ftester');
  });

  it("offers existing-account password sign-in without a role choice", () => {
    const markup = renderToStaticMarkup(createElement(EmailAuthForm, { mode: "sign-in", returnTo: "/dashboard", defaultMethod: "password" }));
    expect(markup).toContain('name="password"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).toContain("Show password");
    expect(markup).toContain("Use an email link instead");
    expect(markup).toContain('/forgot-password?returnTo=%2Fdashboard');
  });

  it("keeps registration neutral and password-based", () => {
    const markup = renderToStaticMarkup(createElement(EmailAuthForm, { mode: "sign-up", returnTo: "/builder", defaultMethod: "magic" }));
    expect(markup).toContain('name="name"');
    expect(markup).toContain('name="password"');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).toContain("Create account");
    expect(markup.replace(/<[^>]+>/g, "")).not.toMatch(/builder|workspace/i);
    expect(markup).not.toContain("intent=");
  });

  it("explains account-email verification without promising an account merge", () => {
    const markup = renderToStaticMarkup(createElement(AddAccountEmailForm, { returnTo: "/builder/onboarding" }));
    expect(markup).toContain("Account email");
    expect(markup).toContain("same account, linked wallet and existing access");
    expect(markup).toContain("Accounts are not automatically merged");
    expect(markup).toContain("Send verification link");
  });
});

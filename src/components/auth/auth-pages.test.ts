import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SignInPage from "@/app/(auth)/sign-in/page";
import SignUpPage from "@/app/(auth)/sign-up/page";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), redirect: vi.fn() }));
vi.mock("@/src/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  redirect: mocks.redirect,
}));
vi.mock("@/src/lib/auth-client", () => ({ authClient: {} }));
vi.mock("@/src/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("./sign-in-wallet", () => ({
  SignInWallet: ({ returnTo }: { returnTo: string }) => createElement("div", { "data-wallet-return-to": returnTo }, "Wallet sign in"),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue(null);
  mocks.redirect.mockImplementation((target) => { throw new Error(`redirect:${target}`); });
});

describe("auth page contracts", () => {
  it.each([undefined, "builder", "tester"])("shows common methods for intent %s with one H1 and mobile form first", async (intent) => {
    const markup = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ intent }) }));
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain("Sign in to SeekerHub");
    expect(markup).toContain("Send magic link");
    expect(markup).toContain("Use a password instead");
    expect(markup).toContain("Wallet sign in");
    expect(markup).toContain('class="order-1 w-full max-w-lg');
    expect(markup).not.toContain('name="password"');
  });

  it("selects existing password sign-in only through method=password", async () => {
    const markup = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ intent: "tester", method: "password", returnTo: "/invite/token" }) }));
    expect(markup).toContain('name="password"');
    expect(markup).toContain("Use an email link instead");
    expect(markup).toContain('data-wallet-return-to="/invite/token"');
  });

  it.each([SignInPage, SignUpPage])("redirects durable users to a safe target", async (Page) => {
    mocks.getSession.mockResolvedValue({ user: { isAnonymous: false } });
    await expect(Page({ searchParams: Promise.resolve({ returnTo: "//evil.example", intent: "tester" }) })).rejects.toThrow("redirect:/tester");
    await expect(Page({ searchParams: Promise.resolve({ returnTo: "/dashboard", intent: "builder" }) })).rejects.toThrow("redirect:/dashboard");
  });

  it.each([SignInPage, SignUpPage])("leaves anonymous sessions on the auth page for upgrade", async (Page) => {
    mocks.getSession.mockResolvedValue({ user: { isAnonymous: true } });
    await Page({ searchParams: Promise.resolve({ returnTo: "/dashboard" }) });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("renders neutral registration with one H1 and no wallet provider path", async () => {
    const markup = renderToStaticMarkup(await SignUpPage({ searchParams: Promise.resolve({}) }));
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain("Create your SeekerHub account");
    expect(markup).toContain('name="password"');
    expect(markup).not.toContain("Wallet sign in");
    expect(markup).not.toMatch(/Builder registration|builder account|workspace/i);
  });
});

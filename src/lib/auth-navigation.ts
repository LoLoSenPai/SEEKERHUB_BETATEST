import { safeReturnTo } from "./redirect";

type AuthNavigationParams = {
  returnTo?: string | string[] | null;
  intent?: string | string[] | null;
};

export type EmailAuthMethod = "magic" | "password";

export function getAuthReturnTo({ returnTo, intent }: AuthNavigationParams = {}) {
  const fallback = intent === "builder" ? "/builder" : intent === "tester" ? "/tester" : "/dashboard";
  const target = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined, fallback);
  const pathname = target.split(/[?#]/, 1)[0];
  return /^\/(?:sign-in|sign-up)(?:\/|$)/.test(pathname) ? fallback : target;
}

export function getEmailAuthMethod(mode: "sign-in" | "sign-up", defaultMethod?: string): EmailAuthMethod {
  return mode === "sign-up" || defaultMethod === "password" ? "password" : "magic";
}

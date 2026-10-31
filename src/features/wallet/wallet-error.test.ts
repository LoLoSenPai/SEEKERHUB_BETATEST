import { describe, expect, it } from "vitest";
import { getWalletErrorCode, getWalletErrorMessage } from "./wallet-error";

describe("wallet error feedback", () => {
  it.each([
    { code: "cancelled" },
    { error: { code: "cancelled" } },
    { cause: { error: { code: "cancelled" } } },
  ])("keeps cancellation silent, including adapter wrappers", (error) => {
    expect(getWalletErrorMessage(error)).toBeNull();
  });
  it("makes session closure actionable without an automatic retry", () => {
    expect(getWalletErrorMessage({ error: { code: "session-closed" } })).toContain("retry manually");
    expect(getWalletErrorMessage({ error: { code: "session-closed" } })).toContain("No automatic retry");
  });
  it("provides an alternative when Seeker association fails", () => {
    expect(getWalletErrorMessage({ error: { code: "association-failed" } })).toContain("choose another wallet");
  });
  it("preserves server account-switch errors", () => {
    expect(getWalletErrorMessage(new Error("Sign out before using another account"))).toBe("Sign out before using another account");
  });
  it("handles circular wrappers safely", () => {
    const error: { error?: unknown } = {};
    error.error = error;
    expect(getWalletErrorCode(error)).toBeUndefined();
  });
});

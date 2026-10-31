import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { shortWalletAddress } from "./use-wallet-name";
import { WalletName } from "./wallet-name";

describe("WalletName pre-authentication fallback", () => {
  it("renders an address immediately without waiting for a domain or exposing an internal email", () => {
    const address = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk";
    const markup = renderToStaticMarkup(createElement(WalletName, { address, className: "wallet-label" }));
    expect(markup).toContain("1234...hijk");
    expect(markup).toContain(`title="${address}"`);
    expect(markup).toContain('class="wallet-label"');
    expect(markup).not.toContain("seekerhub.local");
    expect(markup).not.toContain("http");
  });

  it("still renders the address fallback when showAddress is false", () => {
    expect(renderToStaticMarkup(createElement(WalletName, { address: "123456789123456789", showAddress: false }))).toContain("1234...6789");
  });

  it("handles short or empty address inputs without producing a blank spinner", () => {
    expect(shortWalletAddress("short")).toBe("short");
    expect(shortWalletAddress("")).toBe("");
  });
});

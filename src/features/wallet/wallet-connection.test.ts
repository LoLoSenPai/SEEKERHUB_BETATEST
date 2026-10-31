import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ButtonHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletConnectButton } from "./wallet-connect-button";
import { SeekerConnectButton } from "./seeker-connect-button";

const mocks = vi.hoisted(() => ({
  buttons: [] as ButtonHTMLAttributes<HTMLButtonElement>[],
  wallet: {
    connected: false, connecting: false, disconnecting: false, publicKey: null,
    wallet: null as null | { adapter: { name: string } },
    wallets: [] as { adapter: { name: string } }[],
    select: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  },
  setVisible: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => boolean) => getSnapshot(),
}));
vi.mock("@solana/wallet-adapter-react", () => ({ useWallet: () => mocks.wallet }));
vi.mock("@solana/wallet-adapter-react-ui", () => ({ useWalletModal: () => ({ setVisible: mocks.setVisible }) }));
vi.mock("@solana-mobile/seeker-connect-wallet-standard", () => ({ SeekerConnectWalletName: "Seeker Connect" }));
vi.mock("@solana-mobile/wallet-standard-mobile", () => ({ SolanaMobileWalletAdapterWalletName: "Mobile Wallet Adapter" }));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
vi.mock("./wallet-name", () => ({ WalletName: () => null }));
vi.mock("@/src/components/ui/button", () => ({ Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => {
  mocks.buttons.push(props);
  return createElement("button", { disabled: props.disabled }, props.children);
} }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buttons.length = 0;
  Object.assign(mocks.wallet, { connected: false, connecting: false, disconnecting: false, wallet: null, wallets: [] });
  vi.stubGlobal("navigator", { userAgent: "Android Chrome/140" });
});
afterEach(() => vi.unstubAllGlobals());

describe("wallet connection controls", () => {
  it("keeps the disconnected label identical with and without the client-only mobile registry", () => {
    const serverMarkup = renderToStaticMarkup(createElement(WalletConnectButton));
    mocks.wallet.wallets = [{ adapter: { name: "Mobile Wallet Adapter" } }];
    const clientMarkup = renderToStaticMarkup(createElement(WalletConnectButton));
    expect(clientMarkup).toBe(serverMarkup);
    expect(clientMarkup).toContain("Connect wallet");
  });

  it("preserves the generic all-wallet picker even on Android", () => {
    mocks.wallet.wallets = [{ adapter: { name: "Mobile Wallet Adapter" } }];
    renderToStaticMarkup(createElement(WalletConnectButton));
    const picker = mocks.buttons.find((button) => button.children === "Choose another wallet")!;
    picker.onClick?.({} as never);
    expect(mocks.setVisible).toHaveBeenCalledWith(true);
    expect(mocks.wallet.select).not.toHaveBeenCalled();
  });

  it("offers an explicit Android Seeker selector without signing in or verifying", async () => {
    mocks.wallet.wallets = [{ adapter: { name: "Seeker Connect" } }];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderToStaticMarkup(createElement(SeekerConnectButton));
    expect(mocks.buttons[0].children).toBe("Use Seeker Connect");
    await mocks.buttons[0].onClick?.({} as never);
    expect(mocks.wallet.select).toHaveBeenCalledExactlyOnceWith("Seeker Connect");
    expect(mocks.wallet.connect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for the old adapter to disconnect before opening the generic picker", async () => {
    mocks.wallet.connected = true;
    mocks.wallet.wallet = { adapter: { name: "Seeker Connect" } };
    let finish!: () => void;
    mocks.wallet.disconnect.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderToStaticMarkup(createElement(WalletConnectButton));
    const picker = mocks.buttons.find((button) => button.children === "Choose another wallet")!;
    const changing = picker.onClick?.({} as never);
    expect(mocks.wallet.disconnect).toHaveBeenCalledOnce();
    expect(mocks.setVisible).not.toHaveBeenCalled();
    finish();
    await changing;
    expect(mocks.setVisible).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.wallet.select).not.toHaveBeenCalled();
  });

  it("retires a different adapter before requesting Seeker selection", async () => {
    mocks.wallet.wallets = [{ adapter: { name: "Seeker Connect" } }];
    mocks.wallet.wallet = { adapter: { name: "Other wallet" } };
    mocks.wallet.connected = true;
    renderToStaticMarkup(createElement(SeekerConnectButton));
    await mocks.buttons[0].onClick?.({} as never);
    expect(mocks.wallet.disconnect).toHaveBeenCalledOnce();
    // Selection follows a provider re-render, covered by the Android browser journey.
    expect(mocks.wallet.select).not.toHaveBeenCalled();
  });

  it("does not offer Seeker Connect on desktop", () => {
    vi.stubGlobal("navigator", { userAgent: "Desktop Chrome" });
    mocks.wallet.wallets = [{ adapter: { name: "Seeker Connect" } }];
    expect(renderToStaticMarkup(createElement(SeekerConnectButton))).toBe("");
  });

  it("does not offer an unavailable or disabled registration", () => {
    expect(renderToStaticMarkup(createElement(SeekerConnectButton))).toBe("");
  });

  it("keeps cancelled Seeker connection silent and never retries automatically", async () => {
    mocks.wallet.wallets = [{ adapter: { name: "Seeker Connect" } }];
    mocks.wallet.wallet = mocks.wallet.wallets[0];
    mocks.wallet.connect.mockRejectedValueOnce({ error: { code: "cancelled" } });
    renderToStaticMarkup(createElement(SeekerConnectButton));
    await mocks.buttons[0].onClick?.({} as never);
    expect(mocks.wallet.connect).toHaveBeenCalledOnce();
    expect(mocks.wallet.select).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("does not retry a session-closed connection or change wallets", async () => {
    mocks.wallet.wallets = [{ adapter: { name: "Seeker Connect" } }];
    mocks.wallet.wallet = mocks.wallet.wallets[0];
    mocks.wallet.connect.mockRejectedValueOnce({ error: { code: "session-closed" } });
    renderToStaticMarkup(createElement(SeekerConnectButton));
    await mocks.buttons[0].onClick?.({} as never);
    expect(mocks.wallet.connect).toHaveBeenCalledOnce();
    expect(mocks.wallet.select).not.toHaveBeenCalled();
  });
});

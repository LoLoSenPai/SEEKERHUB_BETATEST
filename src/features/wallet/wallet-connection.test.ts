import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ButtonHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletConnectButton } from "./wallet-connect-button";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string };
const mocks = vi.hoisted(() => ({
  buttons: [] as ButtonProps[],
  wallet: {
    connected: false, connecting: false, disconnecting: false,
    publicKey: null as null | { toBase58: () => string },
    wallet: null as null | { adapter: { name: string } },
    wallets: [] as { adapter: { name: string } }[],
    select: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  },
  setVisible: vi.fn(), toast: vi.fn(), walletName: vi.fn(() => "Unexpected wallet name"),
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => boolean) => getSnapshot(),
}));
vi.mock("@solana/wallet-adapter-react", () => ({ useWallet: () => mocks.wallet }));
vi.mock("@solana/wallet-adapter-react-ui", () => ({ useWalletModal: () => ({ setVisible: mocks.setVisible }) }));
vi.mock("@solana-mobile/wallet-standard-mobile", () => ({ SolanaMobileWalletAdapterWalletName: "Mobile Wallet Adapter" }));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
vi.mock("./wallet-name", () => ({ WalletName: mocks.walletName }));
vi.mock("@/src/components/ui/button", () => ({ Button: (props: ButtonProps) => {
  mocks.buttons.push(props);
  return createElement("button", { disabled: props.disabled }, props.children);
} }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buttons.length = 0;
  Object.assign(mocks.wallet, { connected: false, connecting: false, disconnecting: false, publicKey: null, wallet: null, wallets: [] });
  vi.stubGlobal("navigator", { userAgent: "Android Chrome/140" });
});
afterEach(() => vi.unstubAllGlobals());

function renderButton(props: Parameters<typeof WalletConnectButton>[0] = {}) {
  mocks.buttons.length = 0;
  const markup = renderToStaticMarkup(createElement(WalletConnectButton, props));
  expect(mocks.buttons).toHaveLength(1);
  expect(markup.match(/<button\b/g)).toHaveLength(1);
  expect(markup).not.toContain("Choose another wallet");
  expect(mocks.walletName).not.toHaveBeenCalled();
  return { markup, button: mocks.buttons[0] };
}

describe("wallet connection controls", () => {
  it("keeps one stable Connect wallet button with and without the mobile registry", () => {
    const { markup: initial } = renderButton();
    mocks.wallet.wallets = [{ adapter: { name: "Mobile Wallet Adapter" } }];
    const { markup, button } = renderButton();
    expect(markup).toBe(initial);
    expect(markup).toContain("Connect wallet");
    expect(button.disabled).toBeFalsy();
    expect(mocks.wallet.select).not.toHaveBeenCalled();
    expect(mocks.wallet.connect).not.toHaveBeenCalled();
  });

  it("selects available MWA on Android Chrome without also connecting", async () => {
    mocks.wallet.wallets = [{ adapter: { name: "Mobile Wallet Adapter" } }];
    await renderButton().button.onClick?.({} as never);
    expect(mocks.wallet.select).toHaveBeenCalledExactlyOnceWith("Mobile Wallet Adapter");
    expect(mocks.wallet.connect).not.toHaveBeenCalled();
    expect(mocks.setVisible).not.toHaveBeenCalledWith(true);
  });

  it("connects selected MWA only after an explicit click", async () => {
    mocks.wallet.wallet = { adapter: { name: "Mobile Wallet Adapter" } };
    const { button } = renderButton();
    expect(mocks.wallet.connect).not.toHaveBeenCalled();
    await button.onClick?.({} as never);
    expect(mocks.wallet.connect).toHaveBeenCalledOnce();
    expect(mocks.wallet.select).not.toHaveBeenCalled();
    expect(mocks.setVisible).not.toHaveBeenCalled();
  });

  it.each([
    ["Desktop Chrome", true], ["Android Chrome/140", false],
    ["Android Chrome/140 EdgA/140", true], ["Android Chrome/140 OPR/90", true],
    ["Android Chrome/140 SamsungBrowser/29", true],
  ])("opens the modal for %s (MWA available: %s)", async (userAgent, available) => {
    vi.stubGlobal("navigator", { userAgent });
    if (available) mocks.wallet.wallets = [{ adapter: { name: "Mobile Wallet Adapter" } }];
    await renderButton().button.onClick?.({} as never);
    expect(mocks.setVisible).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.wallet.select).not.toHaveBeenCalled();
    expect(mocks.wallet.connect).not.toHaveBeenCalled();
  });

  it("shows only Disconnect wallet as ghost and awaits disconnection", async () => {
    mocks.wallet.connected = true;
    mocks.wallet.wallet = { adapter: { name: "Other wallet" } };
    mocks.wallet.publicKey = { toBase58: () => "WalletAddress" };
    let finish!: () => void;
    mocks.wallet.disconnect.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { markup, button } = renderButton();
    expect(markup).toContain("Disconnect wallet");
    expect(markup).not.toContain("WalletAddress");
    expect(markup).not.toContain("Other wallet");
    expect(button.variant).toBe("ghost");
    let settled = false;
    const disconnecting = Promise.resolve(button.onClick?.({} as never)).then(() => { settled = true; });
    await Promise.resolve();
    expect(mocks.wallet.disconnect).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    finish();
    await disconnecting;
    expect(settled).toBe(true);
    expect(mocks.setVisible).not.toHaveBeenCalled();
    expect(mocks.wallet.select).not.toHaveBeenCalled();
    expect(mocks.wallet.connect).not.toHaveBeenCalled();
  });

  it.each([
    [true, false, "Connecting wallet..."], [false, true, "Disconnecting wallet..."],
  ])("disables the button while connecting=%s disconnecting=%s", (connecting, disconnecting, label) => {
    Object.assign(mocks.wallet, { connecting, disconnecting, connected: disconnecting });
    const { markup, button } = renderButton();
    expect(markup).toContain(label);
    expect(button.disabled).toBe(true);
  });

  it.each([false, true])("honors disabled when connected=%s", (connected) => {
    mocks.wallet.connected = connected;
    expect(renderButton({ disabled: true }).button.disabled).toBe(true);
    expect(mocks.wallet.connect).not.toHaveBeenCalled();
    expect(mocks.wallet.disconnect).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "session-closed"])("does not retry or change wallets after %s", async (code) => {
    mocks.wallet.wallet = { adapter: { name: "Mobile Wallet Adapter" } };
    mocks.wallet.connect.mockRejectedValueOnce({ error: { code } });
    await renderButton().button.onClick?.({} as never);
    expect(mocks.wallet.connect).toHaveBeenCalledOnce();
    expect(mocks.wallet.select).not.toHaveBeenCalled();
    expect(mocks.wallet.disconnect).not.toHaveBeenCalled();
    expect(mocks.setVisible).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

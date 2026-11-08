import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerMwa: vi.fn(), registerSeekerWallet: vi.fn(),
  authorizationCache: {}, chainSelector: vi.fn(), walletNotFound: vi.fn(),
  getClientEnv: vi.fn(() => ({
    NEXT_PUBLIC_APP_URL: "https://configured.example.test",
    NEXT_PUBLIC_SEEKER_RELAY_DOMAIN: "relay.solanamobile.com",
    NEXT_PUBLIC_ENABLE_SEEKER_CONNECT: false,
  })),
}));

vi.mock("@solana/wallet-adapter-react", () => ({ ConnectionProvider: () => null, WalletProvider: () => null }));
vi.mock("@solana/wallet-adapter-react-ui", () => ({ WalletModalProvider: () => null }));
vi.mock("@solana-mobile/seeker-connect-wallet-standard", () => ({ SeekerConnectWalletName: "Seeker Connect" }));
vi.mock("@solana-mobile/wallet-standard-mobile", () => ({
  registerMwa: mocks.registerMwa,
  createDefaultAuthorizationCache: () => mocks.authorizationCache,
  createDefaultChainSelector: () => mocks.chainSelector,
  createDefaultWalletNotFoundHandler: () => mocks.walletNotFound,
}));
vi.mock("./seeker-wallet-registration", () => ({ registerSeekerWallet: mocks.registerSeekerWallet }));
vi.mock("@/src/lib/env", () => ({ getClientEnv: mocks.getClientEnv }));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe("MWA provider identity", () => {
  it("does not register a browser wallet during SSR", async () => {
    vi.stubGlobal("window", undefined);
    await import("./wallet-providers");
    expect(mocks.registerMwa).not.toHaveBeenCalled();
    expect(mocks.registerSeekerWallet).not.toHaveBeenCalled();
  });

  it.each(["https://actual.example.test", "http://127.0.0.1:3100"])("registers once with the actual origin %s and leaves wallet configuration unchanged", async (origin) => {
    vi.stubGlobal("window", { location: { origin, protocol: new URL(origin).protocol } });
    await import("./wallet-providers");
    await import("./wallet-providers");
    expect(mocks.registerMwa).toHaveBeenCalledExactlyOnceWith({
      appIdentity: { name: "SeekerHub", uri: origin, icon: "/brand/seekerhub-icon.png" },
      authorizationCache: mocks.authorizationCache,
      chains: ["solana:mainnet"], chainSelector: mocks.chainSelector,
      onWalletNotFound: mocks.walletNotFound,
    });
    expect(mocks.registerSeekerWallet).toHaveBeenCalledExactlyOnceWith("relay.solanamobile.com", false);
  });
});

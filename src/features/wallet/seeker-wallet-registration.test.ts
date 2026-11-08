import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@solana-mobile/seeker-connect-wallet-standard", () => ({ registerSeekerConnect: mocks.register }));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe("Seeker Connect registration", () => {
  it("requires explicit opt-in even with HTTPS and a relay", async () => {
    vi.stubGlobal("window", { location: { protocol: "https:", origin: "https://review.example.test" } });
    const { registerSeekerWallet } = await import("./seeker-wallet-registration");
    registerSeekerWallet("relay.solanamobile.com");
    registerSeekerWallet("relay.solanamobile.com", false);
    expect(mocks.register).not.toHaveBeenCalled();
    registerSeekerWallet("relay.solanamobile.com", true);
    expect(mocks.register).toHaveBeenCalledOnce();
  });

  it("does not register during SSR", async () => {
    vi.stubGlobal("window", undefined);
    const { registerSeekerWallet } = await import("./seeker-wallet-registration");
    registerSeekerWallet("relay.solanamobile.com", true);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("an empty relay disables registration without touching the SDK", async () => {
    vi.stubGlobal("window", { location: { protocol: "https:", origin: "https://review.example.test" } });
    const { registerSeekerWallet } = await import("./seeker-wallet-registration");
    registerSeekerWallet("", true);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("never substitutes a configured production origin for an HTTP site", async () => {
    vi.stubGlobal("window", { location: { protocol: "http:", origin: "http://127.0.0.1:3000" } });
    const { registerSeekerWallet } = await import("./seeker-wallet-registration");
    registerSeekerWallet("relay.solanamobile.com", true);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("registers once, using the real HTTPS origin, configured relay and SDK's unmodified App Link default", async () => {
    vi.stubGlobal("window", { location: { protocol: "https:", origin: "https://actual.example.test" } });
    const { registerSeekerWallet } = await import("./seeker-wallet-registration");
    registerSeekerWallet("relay.solanamobile.com", true);
    registerSeekerWallet("relay.solanamobile.com", true);
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith({
      identity: { name: "SeekerHub", uri: "https://actual.example.test", icon: "/brand/seekerhub-icon.png" },
      relayDomain: "relay.solanamobile.com", chain: "solana:mainnet",
    });
    expect(mocks.register.mock.calls[0][0]).not.toHaveProperty("firstConnectWalletBaseUri");
  });
});

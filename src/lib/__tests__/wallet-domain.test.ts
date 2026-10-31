import { createSolanaRpc } from "@solana/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWalletDomainResolver, WALLET_DOMAIN_NEGATIVE_TTL_MS, WALLET_DOMAIN_POSITIVE_TTL_MS } from "@/src/lib/solana/wallet-domain";
import { randomWalletAddress, skrRpcFixture } from "@/tests/fixtures/skr-domain";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup(options: Omit<Parameters<typeof createWalletDomainResolver>[0], "rpc"> = {}) {
  const fixture = await skrRpcFixture();
  vi.stubGlobal("fetch", fixture.fetch);
  return { ...fixture, resolve: createWalletDomainResolver({ rpc: createSolanaRpc(fixture.endpoint), ...options }) };
}

describe("primary-only wallet name resolver", () => {
  it("uses a fixed mocked loopback transport independently of the service environment", async () => {
    vi.stubEnv("SOLANA_RPC_URL", "https://never-contact.example.test");
    const fixture = await setup();
    expect(fixture.endpoint).toBe("http://127.0.0.1:8899");
    expect(await fixture.resolve(randomWalletAddress())).toBeNull();
    expect(fixture.requests).toHaveLength(1);
    await expect(skrRpcFixture(process.env.SOLANA_RPC_URL)).rejects.toThrow("loopback RPC");
  });

  it("uses the actual SDK to verify the primary name owner with at most two RPC reads", async () => {
    const fixture = await setup();
    const wallet = randomWalletAddress();
    const domain = await fixture.addPrimary(wallet);
    expect(await fixture.resolve(wallet)).toBe(domain);
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests.every(({ method }) => method === "getAccountInfo")).toBe(true);
  });

  it.each(["transferred", "expired", "other-tld", "no-primary"])("does not display a %s primary or fall back to unsolicited owned names", async (condition) => {
    const fixture = await setup();
    const wallet = randomWalletAddress();
    if (condition !== "no-primary") await fixture.addPrimary(wallet, {
      ...(condition === "transferred" ? { owner: randomWalletAddress() } : {}),
      ...(condition === "expired" ? { expired: true } : {}),
      ...(condition === "other-tld" ? { tld: ".sol" } : {}),
    });
    expect(await fixture.resolve(wallet)).toBeNull();
    expect(fixture.requests.length).toBeLessThanOrEqual(2);
  });

  it("caches a positive result for exactly one hour", async () => {
    let now = Date.now();
    const fixture = await setup({ now: () => now });
    const wallet = randomWalletAddress();
    const original = await fixture.addPrimary(wallet);
    expect(await fixture.resolve(wallet)).toBe(original);
    const changed = await fixture.addPrimary(wallet);
    now += WALLET_DOMAIN_POSITIVE_TTL_MS - 1;
    expect(await fixture.resolve(wallet)).toBe(original);
    expect(fixture.requests).toHaveLength(2);
    now += 1;
    expect(await fixture.resolve(wallet)).toBe(changed);
    expect(fixture.requests).toHaveLength(4);
  });

  it("caches a genuine absence for five minutes, not for an hour", async () => {
    let now = Date.now();
    const fixture = await setup({ now: () => now });
    const wallet = randomWalletAddress();
    expect(await fixture.resolve(wallet)).toBeNull();
    const domain = await fixture.addPrimary(wallet);
    now += WALLET_DOMAIN_NEGATIVE_TTL_MS - 1;
    expect(await fixture.resolve(wallet)).toBeNull();
    expect(fixture.requests).toHaveLength(1);
    now += 1;
    expect(await fixture.resolve(wallet)).toBe(domain);
    expect(fixture.requests).toHaveLength(3);
  });

  it("never negative-caches provider failures or leaks provider secrets", async () => {
    const fixture = await setup();
    const wallet = randomWalletAddress();
    fixture.setMode("error");
    await expect(fixture.resolve(wallet)).rejects.toMatchObject({ status: 503, code: "WALLET_DOMAIN_UNAVAILABLE",
      message: "Wallet names are temporarily unavailable." });
    fixture.setMode("healthy");
    expect(await fixture.resolve(wallet)).toBeNull();
    expect(fixture.requests).toHaveLength(2);
  });

  it("coalesces simultaneous cache misses for one wallet", async () => {
    const fixture = await setup();
    const wallet = randomWalletAddress();
    const domain = await fixture.addPrimary(wallet);
    expect(await Promise.all(Array.from({ length: 8 }, () => fixture.resolve(wallet)))).toEqual(Array(8).fill(domain));
    expect(fixture.requests).toHaveLength(2);
  });

  it("evicts the least recently used entry at the configured cache bound", async () => {
    const fixture = await setup({ maxEntries: 2 });
    const [first, second, third] = Array.from({ length: 3 }, randomWalletAddress);
    await fixture.resolve(first);
    await fixture.resolve(second);
    await fixture.resolve(first);
    await fixture.resolve(third);
    await fixture.resolve(first);
    expect(fixture.requests).toHaveLength(3);
    await fixture.resolve(second);
    expect(fixture.requests).toHaveLength(4);
  });

  it("bounds in-flight work, aborts stalled RPCs and releases capacity after a timeout", async () => {
    const fixture = await setup({ maxPending: 1, timeoutMs: 40 });
    fixture.setMode("hang");
    const wallet = randomWalletAddress();
    const stalled = fixture.resolve(wallet);
    const rejected = expect(stalled).rejects.toMatchObject({ status: 503, code: "WALLET_DOMAIN_UNAVAILABLE" });
    await expect(fixture.resolve(randomWalletAddress())).rejects.toMatchObject({ status: 503 });
    await rejected;
    fixture.setMode("healthy");
    expect(await fixture.resolve(wallet)).toBeNull();
    expect(fixture.requests).toHaveLength(2);
  });

  it.each(["", "0".repeat(44), "a".repeat(1_000), "alice.skr"])("rejects invalid address %j before any RPC call", async (wallet) => {
    const fixture = await setup();
    await expect(fixture.resolve(wallet)).rejects.toMatchObject({ status: 400, code: "INVALID_WALLET_ADDRESS" });
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
});

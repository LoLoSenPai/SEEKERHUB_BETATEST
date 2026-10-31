import { describe, expect, it, vi } from "vitest";
import { createWalletNameLookup } from "./wallet-name-lookup";

const address = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk";
const secondAddress = "223456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk";
const thirdAddress = "323456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk";
const response = (domain: string | null = "tester.skr", wallet = address) => Response.json({
  address: wallet, domain, source: domain ? "primary" : null,
}, { status: domain ? 200 : 404 });

describe("shared client wallet name lookups", () => {
  it("coalesces three concurrent components into one authenticated, address-only request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
    const cache = createWalletNameLookup({ fetcher });
    const lookups = Array.from({ length: 3 }, () => cache.lookup("user-a", address));
    expect(lookups[0]).toBe(lookups[1]);
    expect(await Promise.all(lookups)).toEqual(Array(3).fill("tester.skr"));
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/wallet/domain", expect.objectContaining({
      credentials: "same-origin", cache: "no-store", body: JSON.stringify({ address }),
    }));
  });

  it("keeps successful primary lookups for one hour", async () => {
    let now = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
    const cache = createWalletNameLookup({ fetcher, now: () => now });
    expect(await cache.lookup("user-a", address)).toBe("tester.skr");
    now = 60 * 60_000 - 1;
    expect(await cache.lookup("user-a", address)).toBe("tester.skr");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 1;
    await cache.lookup("user-a", address);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps only genuine 404 absences for five minutes", async () => {
    let now = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(null));
    const cache = createWalletNameLookup({ fetcher, now: () => now });
    expect(await cache.lookup("user-a", address)).toBeNull();
    now = 5 * 60_000 - 1;
    await cache.lookup("user-a", address);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 1;
    await cache.lookup("user-a", address);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 429, 503])("does not negative-cache HTTP %s", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status }))
      .mockImplementation(async () => response());
    const cache = createWalletNameLookup({ fetcher });
    expect(await cache.lookup("user-a", address)).toBeNull();
    expect(await cache.lookup("user-a", address)).toBe("tester.skr");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures, malformed bodies, unsolicited names or address mismatches", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(Response.json({ error: "No route" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ address, domain: "unsolicited.skr", source: "owned" }))
      .mockResolvedValueOnce(response("other.skr", secondAddress))
      .mockResolvedValueOnce(new Response("not-json"))
      .mockImplementation(async () => response());
    const cache = createWalletNameLookup({ fetcher });
    for (let attempt = 0; attempt < 5; attempt += 1) expect(await cache.lookup("user-a", address)).toBeNull();
    expect(await cache.lookup("user-a", address)).toBe("tester.skr");
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("never shares cached or pending results between users and skips lookups after logout", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
    const cache = createWalletNameLookup({ fetcher });
    const oldUser = cache.lookup("user-a", address);
    expect(await cache.lookup(null, address)).toBeNull();
    const newUser = cache.lookup("user-b", address);
    expect(oldUser).not.toBe(newUser);
    await Promise.all([oldUser, newUser]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await cache.lookup("user-b", address);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("detaches a stale consumer without aborting another component's shared request", async () => {
    let complete!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const cache = createWalletNameLookup({ fetcher });
    const stale = vi.fn();
    const current = vi.fn();
    const detach = cache.subscribe("user-a", address, stale);
    cache.subscribe("user-a", address, current);
    await Promise.resolve();
    detach();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
    complete(response());
    await cache.lookup("user-a", address);
    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledExactlyOnceWith("tester.skr");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("ignores stale results after logout/address changes while the next consumer resolves independently", async () => {
    let complete!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }))
      .mockImplementation(async () => response("next.skr", secondAddress));
    const cache = createWalletNameLookup({ fetcher });
    const stale = vi.fn();
    const next = vi.fn();
    const detach = cache.subscribe("user-a", address, stale);
    await Promise.resolve();
    detach();
    cache.subscribe("user-b", secondAddress, next);
    await cache.lookup("user-b", secondAddress);
    complete(response("old.skr"));
    await cache.lookup("user-a", address);
    expect(stale).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledExactlyOnceWith("next.skr");
  });

  it("evicts settled LRU entries at the cache bound", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_, init) => response(null, JSON.parse(String(init?.body)).address));
    const cache = createWalletNameLookup({ fetcher, maxEntries: 2 });
    await cache.lookup("user-a", address);
    await cache.lookup("user-a", secondAddress);
    await cache.lookup("user-a", address);
    await cache.lookup("user-a", thirdAddress);
    await cache.lookup("user-a", address);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await cache.lookup("user-a", secondAddress);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("bounds pending entries too and removes timed-out requests instead of negative-caching them", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockImplementation(async () => response());
    const cache = createWalletNameLookup({ fetcher, maxEntries: 1, timeoutMs: 20 });
    const first = cache.lookup("user-a", address);
    expect(await cache.lookup("user-a", secondAddress)).toBeNull();
    expect(await first).toBeNull();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(await cache.lookup("user-a", address)).toBe("tester.skr");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

"use client";

type LookupResult = { domain: string | null; cacheable: boolean };
const fallback: LookupResult = { domain: null, cacheable: false };

export function createWalletNameLookup({ fetcher = (...args) => fetch(...args), now = Date.now, maxEntries = 128, timeoutMs = 6_000 }: {
  fetcher?: typeof fetch; now?: () => number; maxEntries?: number; timeoutMs?: number;
} = {}) {
  // Pending and settled entries share one bound. A consumer never owns the shared abort signal.
  const entries = new Map<string, { promise: Promise<string | null>; expiresAt: number | null }>();

  function lookup(userId: string | null | undefined, address: string): Promise<string | null> {
    if (!userId || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return Promise.resolve(null);
    const key = JSON.stringify([userId, address]);
    const cached = entries.get(key);
    if (cached && (cached.expiresAt === null || cached.expiresAt > now())) {
      entries.delete(key);
      entries.set(key, cached);
      return cached.promise;
    }
    entries.delete(key);
    if (entries.size >= maxEntries) {
      const settled = [...entries].find(([, entry]) => entry.expiresAt !== null);
      if (!settled) return Promise.resolve(null);
      entries.delete(settled[0]);
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<LookupResult>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(fallback); }, timeoutMs);
    });
    const request = Promise.resolve().then(async (): Promise<LookupResult> => {
      const response = await fetcher("/api/wallet/domain", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ address }),
      });
      if (response.status !== 200 && response.status !== 404) return fallback;
      const data = await response.json() as { address?: unknown; domain?: unknown; source?: unknown } | null;
      if (!data || data.address !== address) return fallback;
      if (response.status === 404) {
        return data.domain === null && data.source === null ? { domain: null, cacheable: true } : fallback;
      }
      if (data.source !== "primary" || typeof data.domain !== "string" || !data.domain.endsWith(".skr") ||
        data.domain.length > 128 || /[\s\p{C}]/u.test(data.domain)) return fallback;
      return { domain: data.domain, cacheable: true };
    });
    const promise = Promise.race([request, timeout]).catch(() => fallback).then((result) => {
      if (result.cacheable) {
        entries.set(key, { promise, expiresAt: now() + (result.domain ? 60 * 60_000 : 5 * 60_000) });
      } else entries.delete(key);
      return result.domain;
    }).finally(() => clearTimeout(timer!));
    entries.set(key, { promise, expiresAt: null });
    return promise;
  }

  function subscribe(userId: string, address: string, onResolved: (domain: string | null) => void) {
    let active = true;
    void lookup(userId, address).then((domain) => { if (active) onResolved(domain); });
    // Unmount/logout/address changes detach this consumer, without cancelling other subscribers.
    return () => { active = false; };
  }

  return { lookup, subscribe };
}

export const walletNameLookup = createWalletNameLookup();

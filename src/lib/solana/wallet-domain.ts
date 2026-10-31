import { address, createSolanaRpc, isAddress } from "@solana/kit";
import { getPrimarySkrDomain } from "@solana-mobile/skr-domain";
import { prisma } from "@/src/lib/db";
import { getServerEnv } from "@/src/lib/env";
import { AppError } from "@/src/lib/errors";

export const WALLET_DOMAIN_POSITIVE_TTL_MS = 60 * 60_000;
export const WALLET_DOMAIN_NEGATIVE_TTL_MS = 5 * 60_000;
type DomainRpc = Parameters<typeof getPrimarySkrDomain>[0];

export function validateWalletDomainAddress(input: unknown): string {
  if (typeof input !== "string" || input.length > 44 || !isAddress(input)) {
    throw new AppError("A valid wallet address is required.", 400, "INVALID_WALLET_ADDRESS");
  }
  return input;
}

function unavailable() {
  // Never surface provider errors: they can contain an RPC endpoint/API key.
  return new AppError("Wallet names are temporarily unavailable.", 503, "WALLET_DOMAIN_UNAVAILABLE");
}

// Low-level server resolver. Public callers must use resolveLinkedWalletDomain below.
export function createWalletDomainResolver({ rpc, now = Date.now, timeoutMs = 4_000, maxEntries = 1_000, maxPending = 32 }: {
  rpc: DomainRpc; now?: () => number; timeoutMs?: number; maxEntries?: number; maxPending?: number;
}) {
  const cache = new Map<string, { domain: string | null; expiresAt: number }>();
  const pending = new Map<string, Promise<string | null>>();

  return async function resolve(input: string): Promise<string | null> {
    const wallet = address(validateWalletDomainAddress(input));
    const cached = cache.get(wallet);
    if (cached && cached.expiresAt > now()) {
      cache.delete(wallet);
      cache.set(wallet, cached);
      return cached.domain;
    }
    cache.delete(wallet);
    const existing = pending.get(wallet);
    if (existing) return existing;
    if (pending.size >= maxPending) throw unavailable();

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs);
    });
    const work = (async () => {
      try {
        // Primary only: arbitrary names can be unsolicited transfers. The official SDK
        // forward-resolves the primary name to recheck current ownership and expiry.
        const domain = await Promise.race([
          getPrimarySkrDomain(rpc, wallet, { abortSignal: controller.signal, commitment: "confirmed" }), timeout,
        ]);
        if (domain !== null && (domain.length > 128 || !domain.endsWith(".skr") || /[\s\p{C}]/u.test(domain))) throw unavailable();
        cache.set(wallet, { domain, expiresAt: now() + (domain ? WALLET_DOMAIN_POSITIVE_TTL_MS : WALLET_DOMAIN_NEGATIVE_TTL_MS) });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
        return domain;
      } catch {
        throw unavailable();
      } finally {
        clearTimeout(timer!);
        pending.delete(wallet);
      }
    })();
    pending.set(wallet, work);
    return work;
  };
}

let resolveDomain: ReturnType<typeof createWalletDomainResolver> | undefined;

export async function resolveLinkedWalletDomain(input: { userId: string; address: string }) {
  const walletAddress = validateWalletDomainAddress(input.address);
  // Recheck ownership even on a cache hit. Names are display metadata, never auth keys.
  const wallet = await prisma.wallet.findFirst({ where: {
    userId: input.userId, address: walletAddress, verifiedAt: { lte: new Date() },
  }, select: { id: true } });
  if (!wallet) throw new AppError("This wallet is not linked to your session account.", 403, "WALLET_NOT_LINKED");
  resolveDomain ??= createWalletDomainResolver({ rpc: createSolanaRpc(getServerEnv().SOLANA_RPC_URL) });
  const domain = await resolveDomain(walletAddress);
  return { address: walletAddress, domain, source: domain ? "primary" as const : null };
}

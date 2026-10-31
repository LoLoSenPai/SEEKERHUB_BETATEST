import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomWalletAddress, skrRpcFixture } from "@/tests/fixtures/skr-domain";

const integration = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const userIds = new Set<string>();
const ips = new Set<string>();
let prisma: typeof import("@/src/lib/db").prisma;
let auth: typeof import("@/src/lib/auth").auth;
let POST: typeof import("@/app/api/wallet/domain/route").POST;
let hashRateLimitIdentity: typeof import("@/src/lib/rate-limit").hashRateLimitIdentity;
let rpc: Awaited<ReturnType<typeof skrRpcFixture>>;
let origin: string;
let ip: string;

function request(body: unknown, cookie = "", headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/wallet/domain`, { method: "POST",
    headers: { origin, cookie, "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    body: JSON.stringify(body),
  });
}

async function session() {
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-in/anonymous`, {
    method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": ip }, body: "{}",
  }));
  const data = await response.json();
  if (data.user?.id) userIds.add(data.user.id);
  expect(response.status, JSON.stringify(data)).toBe(200);
  const user = await prisma.user.update({ where: { id: data.user.id }, data: {
    isAnonymous: false, name: "Domain test", email: `skr-domain-${randomUUID()}@example.test`,
  } });
  const wallet = await prisma.wallet.create({ data: { userId: user.id, address: randomWalletAddress(), isPrimary: true, verifiedAt: new Date() } });
  const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  return { user, wallet, cookie };
}

integration("session-bound wallet domain API (only RPC mocked)", () => {
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? "http://missing.invalid");
    const authUrl = new URL(process.env.BETTER_AUTH_URL ?? "http://missing.invalid");
    if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
      !database.pathname.toLowerCase().includes("test") || !["localhost", "127.0.0.1", "[::1]"].includes(authUrl.hostname)) {
      throw new Error("Use scripts/with-review-env.mjs with a migrated, disposable local test database.");
    }
    origin = authUrl.origin;
    rpc = await skrRpcFixture(process.env.SOLANA_RPC_URL ?? "http://missing.invalid");
    vi.stubGlobal("fetch", rpc.fetch);
    ({ prisma } = await import("@/src/lib/db"));
    ({ auth } = await import("@/src/lib/auth"));
    ({ POST } = await import("@/app/api/wallet/domain/route"));
    ({ hashRateLimitIdentity } = await import("@/src/lib/rate-limit"));
  });

  beforeEach(() => {
    ip = `198.19.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
    ips.add(ip);
    rpc.setMode("healthy");
    rpc.requests.length = 0;
    rpc.fetch.mockClear();
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
        await prisma.rateLimitBucket.deleteMany({ where: { action: { in: ["wallet.domain.ip", "wallet.domain.user"] }, keyHash: { in: [
          ...[...ips].map((value) => hashRateLimitIdentity(`ip:${value}:global`)),
          ...[...userIds].map((value) => hashRateLimitIdentity(`user:${value}:global`)),
        ] } } });
        await prisma.rateLimit.deleteMany({ where: { key: { in: [...ips].map((value) => hashRateLimitIdentity(`better-auth:${value}|/sign-in/anonymous`)) } } });
        expect(await prisma.user.count({ where: { id: { in: [...userIds] } } })).toBe(0);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it("requires a real session before any RPC work", async () => {
    const response = await POST(request({ address: randomWalletAddress() }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(rpc.fetch).not.toHaveBeenCalled();
  });

  it("rejects foreign/missing origins and cross-site requests even with a valid cookie", async () => {
    const current = await session();
    const headerCases: Record<string, string>[] = [{ origin: "https://other.example.test" }, { origin: "" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of headerCases) {
      const response = await POST(request({ address: current.wallet.address }, current.cookie, headers));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    }
    expect(rpc.fetch).not.toHaveBeenCalled();
  });

  it("returns an owned primary name but never changes identity, wallets or authentication keys", async () => {
    const current = await session();
    const domain = await rpc.addPrimary(current.wallet.address);
    const response = await POST(request({ address: current.wallet.address }, current.cookie));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ address: current.wallet.address, domain, source: "primary" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Origin");
    expect(rpc.requests).toHaveLength(2);
    expect(await prisma.user.findUnique({ where: { id: current.user.id } })).toEqual(current.user);
    expect(await prisma.wallet.findUnique({ where: { id: current.wallet.id } })).toEqual(current.wallet);
    expect(await prisma.account.count({ where: { userId: current.user.id } })).toBe(0);
  });

  it("denies another account, arbitrary connected wallets and unlinked wallets even when their name is cached", async () => {
    const current = await session();
    const other = await session();
    await rpc.addPrimary(current.wallet.address);
    expect((await POST(request({ address: current.wallet.address }, current.cookie))).status).toBe(200);
    expect((await POST(request({ address: current.wallet.address }, other.cookie))).status).toBe(403);
    expect((await POST(request({ address: randomWalletAddress() }, current.cookie))).status).toBe(403);
    await prisma.wallet.delete({ where: { id: current.wallet.id } });
    expect((await POST(request({ address: current.wallet.address }, current.cookie))).status).toBe(403);
    expect(rpc.requests).toHaveLength(2);
  });

  it("rejects malformed addresses, extra fields and invalid JSON without RPC calls", async () => {
    const current = await session();
    for (const body of [{ address: "alice.skr" }, { address: "0".repeat(44) }, {}, [], { address: current.wallet.address, userId: current.user.id }]) {
      expect((await POST(request(body, current.cookie))).status).toBe(400);
    }
    const malformed = new Request(`${origin}/api/wallet/domain`, { method: "POST",
      headers: { origin, cookie: current.cookie, "content-type": "application/json", "x-forwarded-for": ip }, body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(request({ address: current.wallet.address }, current.cookie, { "content-type": "text/plain" }))).status).toBe(415);
    expect(rpc.fetch).not.toHaveBeenCalled();
  });

  it("bounds both declared and actual request bytes", async () => {
    const current = await session();
    expect((await POST(request({ address: current.wallet.address }, current.cookie, { "content-length": "513" }))).status).toBe(413);
    const response = await POST(request({ address: "a".repeat(1_000) }, current.cookie));
    expect(response.status).toBe(413);
    expect(rpc.fetch).not.toHaveBeenCalled();
  });

  it("returns and caches a genuine no-primary 404", async () => {
    const current = await session();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await POST(request({ address: current.wallet.address }, current.cookie));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ address: current.wallet.address, domain: null, source: null });
    }
    expect(rpc.requests).toHaveLength(1);
  });

  it("reports a transient failure as sanitized 503, never 404, and permits immediate recovery", async () => {
    const current = await session();
    rpc.setMode("error");
    const response = await POST(request({ address: current.wallet.address }, current.cookie));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    const text = await response.text();
    expect(text).toContain("WALLET_DOMAIN_UNAVAILABLE");
    expect(text).not.toContain("DO-NOT-LEAK");
    expect(text).not.toContain("private-rpc");
    rpc.setMode("healthy");
    const domain = await rpc.addPrimary(current.wallet.address);
    const retry = await POST(request({ address: current.wallet.address }, current.cookie));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ domain });
    expect(rpc.requests).toHaveLength(3);
  });

  it("charges the per-user budget even for positive cache hits", async () => {
    const current = await session();
    await rpc.addPrimary(current.wallet.address);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await POST(request({ address: current.wallet.address }, current.cookie));
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const limited = await POST(request({ address: current.wallet.address }, current.cookie));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(rpc.requests).toHaveLength(2);
  });

  it("also bounds unauthenticated probes by IP without spending any RPC quota", async () => {
    const address = randomWalletAddress();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect((await POST(request({ address }))).status).toBe(401);
    }
    expect((await POST(request({ address }))).status).toBe(429);
    expect(rpc.fetch).not.toHaveBeenCalled();
  });
});

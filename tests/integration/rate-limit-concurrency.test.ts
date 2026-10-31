import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const integration = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const action = `regression.concurrent-rate-limit.${randomUUID()}`;
let prisma: typeof import("@/src/lib/db").prisma;
let consumeRateLimit: typeof import("@/src/lib/rate-limit").consumeRateLimit;
let hashRateLimitIdentity: typeof import("@/src/lib/rate-limit").hashRateLimitIdentity;
let AppError: typeof import("@/src/lib/errors").AppError;

function disposableDatabaseOnly() {
  // CI's NODE_ENV is irrelevant; gate actual database destinations before backend imports.
  for (const name of ["DATABASE_URL", "DIRECT_DATABASE_URL"]) {
    const value = process.env[name];
    if (!value && name === "DIRECT_DATABASE_URL") continue;
    const url = new URL(value ?? "http://missing.invalid");
    if (!/^postgres(ql)?:$/.test(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        !url.pathname.toLowerCase().includes("test")) {
      throw new Error(`${name} must point to an explicitly enabled loopback test database.`);
    }
  }
}

integration("atomic rate limit increments on disposable PostgreSQL", () => {
  beforeAll(async () => {
    disposableDatabaseOnly();
    ({ prisma } = await import("@/src/lib/db"));
    ({ consumeRateLimit, hashRateLimitIdentity } = await import("@/src/lib/rate-limit"));
    ({ AppError } = await import("@/src/lib/errors"));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma) await prisma.rateLimitBucket.deleteMany({ where: { action } });
  });

  it("counts all 12 simultaneous attempts, admits exactly 5, returns seven 429s and isolates a second scope", async () => {
    // Freeze only Date.now, not timers or the database: calls cannot straddle a window edge.
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const userId = `rate-limit-regression-${randomUUID()}`;
    const scope = "burst";
    const otherScope = "unaffected";
    const windowMs = 60_000;
    const windowStartedAt = new Date(Math.floor(now / windowMs) * windowMs);
    const request = new Request("http://127.0.0.1/api/regression", { headers: { "x-forwarded-for": "127.0.0.1" } });
    const input = { request, action, userId, scope, windowMs, limit: 5 };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      expect(await prisma.rateLimitBucket.count({ where: { action } })).toBe(0);
      const results = await Promise.race([
        Promise.allSettled(Array.from({ length: 12 }, () => consumeRateLimit(input))),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Rate limit burst exceeded 10 seconds")), 10_000); }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
      const failures = results.filter((result) => result.status === "rejected");
      expect(failures).toHaveLength(7);
      for (const failure of failures) {
        expect(failure.reason).toBeInstanceOf(AppError);
        expect(failure.reason).toMatchObject({ status: 429, code: "RATE_LIMITED" });
      }
      const keyHash = hashRateLimitIdentity(`user:${userId}:${scope}`);
      expect(await prisma.rateLimitBucket.findUnique({ where: {
        keyHash_action_windowStartedAt: { keyHash, action, windowStartedAt },
      } })).toMatchObject({ count: 12 });

      await expect(consumeRateLimit({ ...input, scope: otherScope })).resolves.toBeUndefined();
      const otherHash = hashRateLimitIdentity(`user:${userId}:${otherScope}`);
      expect(await prisma.rateLimitBucket.findUnique({ where: {
        keyHash_action_windowStartedAt: { keyHash: otherHash, action, windowStartedAt },
      } })).toMatchObject({ count: 1 });
      expect(await prisma.rateLimitBucket.findUnique({ where: {
        keyHash_action_windowStartedAt: { keyHash, action, windowStartedAt },
      } })).toMatchObject({ count: 12 });
      expect(await prisma.rateLimitBucket.count({ where: { action } })).toBe(2);
    } finally {
      clearTimeout(timeout);
      clock.mockRestore();
    }
  }, 20_000);
});

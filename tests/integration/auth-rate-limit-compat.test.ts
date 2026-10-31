import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import { hashedAuthRateLimitStorage } from "@/src/lib/auth-rate-limit";
import { hashRateLimitIdentity } from "@/src/lib/rate-limit";

const integration =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const prefix = `auth-compat-${randomUUID()}`;
const hashes: string[] = [];

function identity(label: string) {
  const raw = `${prefix}:${label}:192.0.2.1`;
  const hash = hashRateLimitIdentity(`better-auth:${raw}`);
  hashes.push(hash);
  return { raw, hash };
}

integration("Better Auth 1.7 atomic HMAC storage", () => {
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.includes("test")
    ) {
      throw new Error(
        "Auth storage tests require a disposable local test database.",
      );
    }
  });

  afterAll(async () => {
    if (hashes.length)
      await prisma.rateLimit.deleteMany({ where: { key: { in: hashes } } });
  });

  it("exposes only consume and admits exactly the limit during concurrent first requests", async () => {
    expect(Object.keys(hashedAuthRateLimitStorage)).toEqual(["consume"]);
    const { raw, hash } = identity("new");
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        hashedAuthRateLimitStorage.consume(raw, { window: 900, max: 3 }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(
      results
        .filter((result) => !result.allowed)
        .every(
          (result) =>
            result.retryAfter !== null &&
            result.retryAfter > 0 &&
            result.retryAfter <= 900,
        ),
    ).toBe(true);
    const row = await prisma.rateLimit.findUniqueOrThrow({
      where: { key: hash },
    });
    expect(row.count).toBe(3);
    expect(row.key).toMatch(/^[a-f0-9]{64}$/);
    expect(row.key).not.toContain(raw);
    expect(
      await prisma.rateLimit.findUnique({ where: { key: raw } }),
    ).toBeNull();
  });

  it("resets one expired window atomically without admitting all concurrent callers", async () => {
    const { raw, hash } = identity("expired");
    await prisma.rateLimit.create({
      data: {
        key: hash,
        count: 100,
        lastRequest: BigInt(Date.now() - 901_000),
      },
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        hashedAuthRateLimitStorage.consume(raw, { window: 900, max: 1 }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(
      (await prisma.rateLimit.findUniqueOrThrow({ where: { key: hash } }))
        .count,
    ).toBe(1);
  });

  it("does not overwrite or extend a blocked identity through a get/set fallback", async () => {
    const { raw, hash } = identity("blocked");
    const lastRequest = BigInt(Date.now() - 30_000);
    await prisma.rateLimit.create({
      data: { key: hash, count: 3, lastRequest },
    });
    const result = await hashedAuthRateLimitStorage.consume(raw, {
      window: 900,
      max: 3,
    });
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    const row = await prisma.rateLimit.findUniqueOrThrow({
      where: { key: hash },
    });
    expect(row.count).toBe(3);
    expect(row.lastRequest).toBe(lastRequest);
  });
});

import type { BetterAuthRateLimitStorage } from "better-auth";
import { prisma } from "@/src/lib/db";
import { isUniqueConstraintError } from "@/src/lib/prisma-errors";
import { hashRateLimitIdentity } from "@/src/lib/rate-limit";

function hashedKey(key: string) {
  return hashRateLimitIdentity(`better-auth:${key}`);
}

async function read(key: string) {
  const row = await prisma.rateLimit.findUnique({ where: { key: hashedKey(key) } });
  return row
    ? {
        key,
        count: row.count,
        lastRequest: Number(row.lastRequest),
      }
    : null;
}

async function consume(key: string, rule: { window: number; max: number }) {
  const keyHash = hashedKey(key);
  const windowMs = rule.window * 1_000;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const now = Date.now();
    const current = await prisma.rateLimit.findUnique({ where: { key: keyHash } });

    if (!current) {
      try {
        await prisma.rateLimit.create({
          data: { key: keyHash, count: 1, lastRequest: BigInt(now) },
        });
        return { allowed: true, retryAfter: null };
      } catch (error) {
        if (isUniqueConstraintError(error)) continue;
        throw error;
      }
    }

    const lastRequest = Number(current.lastRequest);
    if (now - lastRequest > windowMs) {
      const reset = await prisma.rateLimit.updateMany({
        where: { key: keyHash, lastRequest: current.lastRequest },
        data: { count: 1, lastRequest: BigInt(now) },
      });
      if (reset.count) return { allowed: true, retryAfter: null };
      continue;
    }

    const incremented = await prisma.rateLimit.updateMany({
      where: {
        key: keyHash,
        lastRequest: { gt: BigInt(now - windowMs) },
        count: { lt: rule.max },
      },
      data: { count: { increment: 1 }, lastRequest: BigInt(now) },
    });
    if (incremented.count) return { allowed: true, retryAfter: null };

    const fresh = await prisma.rateLimit.findUnique({ where: { key: keyHash } });
    if (!fresh || now - Number(fresh.lastRequest) > windowMs) continue;
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((Number(fresh.lastRequest) + windowMs - now) / 1_000)),
    };
  }

  return { allowed: false, retryAfter: rule.window };
}

export const hashedAuthRateLimitStorage: BetterAuthRateLimitStorage = {
  get: read,
  set: async (key, value) => {
    await prisma.rateLimit.upsert({
      where: { key: hashedKey(key) },
      create: {
        key: hashedKey(key),
        count: value.count,
        lastRequest: BigInt(value.lastRequest),
      },
      update: {
        count: value.count,
        lastRequest: BigInt(value.lastRequest),
      },
    });
  },
  consume,
};

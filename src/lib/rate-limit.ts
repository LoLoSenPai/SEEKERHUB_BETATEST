import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { getServerEnv } from "@/src/lib/env";
import { AppError } from "@/src/lib/errors";
import { isTransactionConflict, isUniqueConstraintError } from "@/src/lib/prisma-errors";

export const RATE_LIMITS = {
  auth: { limit: 5, windowMs: 15 * 60_000 },
  upload: { limit: 10, windowMs: 60 * 60_000 },
  feedback: { limit: 10, windowMs: 60 * 60_000 },
  wallet: { limit: 10, windowMs: 10 * 60_000 },
  seeker: { limit: 5, windowMs: 10 * 60_000 },
  claim: { limit: 30, windowMs: 60 * 60_000 },
} as const;

function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export function hashRateLimitIdentity(identity: string) {
  const env = getServerEnv();
  const salt = env.RATE_LIMIT_SALT ?? env.BETTER_AUTH_SECRET;
  return createHmac("sha256", salt).update(identity).digest("hex");
}

export async function consumeRateLimit(input: {
  request: Request;
  action: string;
  limit: number;
  windowMs: number;
  userId?: string;
  scope?: string;
}) {
  const now = Date.now();
  const windowStartedAt = new Date(Math.floor(now / input.windowMs) * input.windowMs);
  const expiresAt = new Date(windowStartedAt.getTime() + input.windowMs);
  const identity = input.userId ? `user:${input.userId}` : `ip:${requestIp(input.request)}`;
  const keyHash = hashRateLimitIdentity(`${identity}:${input.scope ?? "global"}`);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const count = await prisma.$transaction(
        async (tx) => {
          const bucket = await tx.rateLimitBucket.upsert({
            where: {
              keyHash_action_windowStartedAt: { keyHash, action: input.action, windowStartedAt },
            },
            create: { keyHash, action: input.action, windowStartedAt, expiresAt, count: 1 },
            update: { count: { increment: 1 } },
            select: { count: true },
          });
          return bucket.count;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (count > input.limit) {
        throw new AppError("Too many requests. Please try again later.", 429, "RATE_LIMITED");
      }
      return;
    } catch (error) {
      if ((isTransactionConflict(error) || isUniqueConstraintError(error)) && attempt === 0) {
        continue;
      }
      throw error;
    }
  }
}

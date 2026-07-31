import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { buildWalletChallengeMessage } from "@/src/lib/solana/wallet";
import { walletChallengeSchema } from "@/src/lib/validation";
import { consumeRateLimit, RATE_LIMITS } from "@/src/lib/rate-limit";
import { apiError, AppError } from "@/src/lib/errors";
import { getServerEnv } from "@/src/lib/env";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    const body = walletChallengeSchema.parse(await request.json());
    if (!session && body.purpose !== "SIGN_IN") {
      throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    }
    await consumeRateLimit({
      request,
      action: "wallet.challenge",
      ...RATE_LIMITS.wallet,
      userId: session?.user.id,
    });
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 10);
    const message = buildWalletChallengeMessage({
      address: body.address,
      nonce,
      appUrl: getServerEnv().BETTER_AUTH_URL,
      purpose: body.purpose,
      expiresAt,
    });

    const challenge = await prisma.walletChallenge.create({
      data: {
        userId: session?.user.id,
        address: body.address,
        nonce,
        message,
        purpose: body.purpose,
        expiresAt,
      },
      select: {
        id: true,
        message: true,
      },
    });

    return NextResponse.json({
      challengeId: challenge.id,
      message: challenge.message,
    });
  } catch (error) {
    return apiError(error, "Unable to create a wallet challenge.");
  }
}

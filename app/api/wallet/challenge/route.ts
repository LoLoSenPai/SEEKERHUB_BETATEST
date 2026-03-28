import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { buildWalletChallengeMessage } from "@/src/lib/solana/wallet";
import { walletChallengeSchema } from "@/src/lib/validation";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = walletChallengeSchema.parse(await request.json());
    const nonce = randomUUID();
    const message = buildWalletChallengeMessage(body.address, nonce);

    const challenge = await prisma.walletChallenge.create({
      data: {
        userId: session.user.id,
        address: body.address,
        nonce,
        message,
        expiresAt: new Date(Date.now() + 1000 * 60 * 10),
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
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create a wallet challenge.",
      },
      { status: 400 },
    );
  }
}

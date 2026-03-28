import bs58 from "bs58";
import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { verifySolanaSignature } from "@/src/lib/solana/wallet";
import { walletLinkSchema } from "@/src/lib/validation";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = walletLinkSchema.parse(await request.json());
    const challenge = await prisma.walletChallenge.findUnique({
      where: { id: body.challengeId },
    });

    if (!challenge || challenge.userId !== session.user.id || challenge.address !== body.address) {
      return NextResponse.json({ error: "Wallet challenge not found." }, { status: 404 });
    }

    if (challenge.usedAt) {
      return NextResponse.json({ error: "Wallet challenge already used." }, { status: 409 });
    }

    if (challenge.expiresAt < new Date()) {
      return NextResponse.json({ error: "Wallet challenge expired." }, { status: 410 });
    }

    const signature = bs58.decode(body.signature);
    const valid = verifySolanaSignature({
      address: body.address,
      message: challenge.message,
      signature,
    });

    if (!valid) {
      return NextResponse.json({ error: "Invalid wallet signature." }, { status: 400 });
    }

    const existingWallet = await prisma.wallet.findUnique({
      where: { address: body.address },
    });

    if (existingWallet && existingWallet.userId !== session.user.id) {
      return NextResponse.json({ error: "This wallet is already linked to another user." }, { status: 409 });
    }

    const wallet = await prisma.$transaction(async (tx) => {
      const linkedWallet = existingWallet
        ? await tx.wallet.update({
            where: { address: body.address },
            data: {
              verifiedAt: new Date(),
            },
          })
        : await tx.wallet.create({
            data: {
              userId: session.user.id,
              address: body.address,
              verifiedAt: new Date(),
              isPrimary: !(await tx.wallet.findFirst({ where: { userId: session.user.id } })),
            },
          });

      await tx.walletChallenge.update({
        where: { id: challenge.id },
        data: { usedAt: new Date() },
      });

      return linkedWallet;
    });

    return NextResponse.json({
      id: wallet.id,
      address: wallet.address,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to link wallet.",
      },
      { status: 400 },
    );
  }
}

import bs58 from "bs58";
import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { verifySolanaSignature } from "@/src/lib/solana/wallet";
import { walletLinkSchema } from "@/src/lib/validation";
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";
import { apiError, AppError } from "@/src/lib/errors";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    }

    const body = walletLinkSchema.parse(await request.json());
    const challenge = await prisma.walletChallenge.findUnique({
      where: { id: body.challengeId },
    });

    if (!challenge || challenge.userId !== session.user.id || challenge.address !== body.address || challenge.purpose !== "LINK") {
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

    const wallet = await prisma.$transaction(async (tx) => {
      const claimed = await tx.walletChallenge.updateMany({
        where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!claimed.count) throw new AppError("Wallet challenge already used or expired.", 409, "CHALLENGE_USED");

      const existingWallet = await tx.wallet.findUnique({ where: { address: body.address } });
      if (existingWallet && existingWallet.userId !== session.user.id) {
        throw new AppError("This wallet is already linked to another user.", 409, "WALLET_ALREADY_LINKED");
      }
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

      if (session.user.isAnonymous) {
        await tx.user.update({ where: { id: session.user.id }, data: { isAnonymous: false } });
        await tx.auditLog.create({
          data: {
            actorUserId: session.user.id,
            action: "tester.account_upgraded_wallet",
            targetType: "User",
            targetId: session.user.id,
          },
        });
      }

      return linkedWallet;
    });

    await reconcilePendingInviteGrants(session.user.id);

    return NextResponse.json({
      id: wallet.id,
      address: wallet.address,
    });
  } catch (error) {
    return apiError(error, "Unable to link wallet.");
  }
}

import bs58 from "bs58";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { apiError, AppError } from "@/src/lib/errors";
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";
import { consumeRateLimit, RATE_LIMITS } from "@/src/lib/rate-limit";
import { SeekerVerificationUnavailableError, verifySeekerGenesisOwnership } from "@/src/lib/solana/sgt";
import { verifySolanaSignature } from "@/src/lib/solana/wallet";
import { verifySeekerSchema } from "@/src/lib/validation";

const VERIFICATION_TTL_MS = 24 * 60 * 60_000;

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");

    const body = verifySeekerSchema.parse(await request.json());
    await consumeRateLimit({
      request,
      action: "wallet.verify-seeker",
      ...RATE_LIMITS.seeker,
      userId: session.user.id,
    });

    const [wallet, challenge] = await Promise.all([
      prisma.wallet.findFirst({ where: { userId: session.user.id, address: body.address } }),
      prisma.walletChallenge.findUnique({ where: { id: body.challengeId } }),
    ]);
    if (!wallet) throw new AppError("Link the wallet before Seeker verification.", 404, "WALLET_NOT_LINKED");
    if (
      !challenge ||
      challenge.userId !== session.user.id ||
      challenge.address !== body.address ||
      challenge.purpose !== "VERIFY_SGT"
    ) {
      throw new AppError("Seeker verification challenge not found.", 404, "CHALLENGE_NOT_FOUND");
    }
    if (challenge.usedAt) throw new AppError("This challenge was already used.", 409, "CHALLENGE_USED");
    if (challenge.expiresAt <= new Date()) throw new AppError("This challenge expired.", 410, "CHALLENGE_EXPIRED");

    const signature = bs58.decode(body.signature);
    if (!verifySolanaSignature({ address: body.address, message: challenge.message, signature })) {
      throw new AppError("Invalid wallet signature.", 400, "INVALID_WALLET_SIGNATURE");
    }

    const claimed = await prisma.walletChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (!claimed.count) throw new AppError("This challenge was already used or expired.", 409, "CHALLENGE_USED");
    const result = await verifySeekerGenesisOwnership(body.address);
    const verifiedAt = new Date();
    await prisma.$transaction(async (tx) => {
      if (result.verified) {
        const existingMint = await tx.wallet.findUnique({ where: { seekerGenesisMintAddress: result.mintAddress } });
        if (
          existingMint &&
          existingMint.id !== wallet.id &&
          existingMint.userId !== session.user.id &&
          existingMint.seekerGenesisVerificationExpiresAt &&
          existingMint.seekerGenesisVerificationExpiresAt > verifiedAt
        ) {
          throw new AppError(
            "This Seeker Genesis Token already verifies another tester account.",
            409,
            "SGT_ALREADY_ASSIGNED",
          );
        }
        if (existingMint && existingMint.id !== wallet.id) {
          await tx.wallet.update({
            where: { id: existingMint.id },
            data: {
              seekerGenesisVerifiedAt: null,
              seekerGenesisVerificationExpiresAt: null,
              seekerGenesisMintAddress: null,
            },
          });
        }
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: result.verified
          ? {
              seekerGenesisVerifiedAt: verifiedAt,
              seekerGenesisVerificationExpiresAt: new Date(verifiedAt.getTime() + VERIFICATION_TTL_MS),
              seekerGenesisMintAddress: result.mintAddress,
            }
          : {
              seekerGenesisVerifiedAt: null,
              seekerGenesisVerificationExpiresAt: null,
              seekerGenesisMintAddress: null,
            },
      });
    });

    if (result.verified) await reconcilePendingInviteGrants(session.user.id);
    return NextResponse.json({ ...result, expiresAt: result.verified ? new Date(verifiedAt.getTime() + VERIFICATION_TTL_MS) : null });
  } catch (error) {
    if (error instanceof SeekerVerificationUnavailableError) {
      return NextResponse.json({ error: error.message, code: "SGT_RPC_UNAVAILABLE" }, { status: 503 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "This Seeker Genesis Token already verifies another tester account.", code: "SGT_ALREADY_ASSIGNED" },
        { status: 409 },
      );
    }
    return apiError(error, "Unable to verify Seeker ownership.");
  }
}

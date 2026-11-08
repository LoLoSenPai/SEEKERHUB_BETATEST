import bs58 from "bs58";
import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { apiError, AppError } from "@/src/lib/errors";
import { getServerEnv } from "@/src/lib/env";
import { SeekerVerificationUnavailableError } from "@/src/lib/solana/sgt";
import { consumeSgtRateLimit, refreshWalletSgtVerification } from "@/src/lib/solana/sgt-verification";
import { verifySolanaSignature } from "@/src/lib/solana/wallet";
import { verifySeekerSchema } from "@/src/lib/validation";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    const body = verifySeekerSchema.parse(await request.json());
    await consumeSgtRateLimit(request, session.user.id);
    const [wallet, challenge] = await Promise.all([
      prisma.wallet.findFirst({ where: { userId: session.user.id, address: body.address } }),
      prisma.walletChallenge.findUnique({ where: { id: body.challengeId } }),
    ]);
    if (!wallet) throw new AppError("Link the wallet before Seeker verification.", 404, "WALLET_NOT_LINKED");
    if (!challenge || challenge.userId !== session.user.id || challenge.address !== body.address || challenge.purpose !== "VERIFY_SGT") {
      throw new AppError("Seeker verification challenge not found.", 404, "CHALLENGE_NOT_FOUND");
    }
    if (challenge.usedAt) throw new AppError("This challenge was already used.", 409, "CHALLENGE_USED");
    if (challenge.expiresAt <= new Date()) throw new AppError("This challenge expired.", 410, "CHALLENGE_EXPIRED");
    const origin = new URL(getServerEnv().BETTER_AUTH_URL);
    let valid = false;
    try {
      valid = challenge.message.startsWith(`${origin.host} wants you to sign in with your Solana account:\n`) &&
        challenge.message.includes(`\nURI: ${origin.origin}\n`) &&
        verifySolanaSignature({ address: body.address, message: challenge.message, signature: bs58.decode(body.signature) });
    } catch { /* Malformed proofs must not reach the chain check. */ }
    if (!valid) throw new AppError("Invalid wallet signature.", 400, "INVALID_WALLET_SIGNATURE");
    const claimed = await prisma.walletChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() },
    });
    if (!claimed.count) throw new AppError("This challenge was already used or expired.", 409, "CHALLENGE_USED");
    return NextResponse.json(await refreshWalletSgtVerification(session.user.id, body.address));
  } catch (error) {
    if (error instanceof SeekerVerificationUnavailableError) {
      return NextResponse.json({ error: error.message, code: "SGT_RPC_UNAVAILABLE" }, { status: 503 });
    }
    return apiError(error, "Unable to verify Seeker ownership.");
  }
}

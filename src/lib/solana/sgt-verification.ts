import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { AppError } from "@/src/lib/errors";
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";
import { logger } from "@/src/lib/logger";
import { consumeRateLimit, RATE_LIMITS } from "@/src/lib/rate-limit";
import { SeekerVerificationUnavailableError, verifySeekerGenesisOwnership } from "./sgt";
import type { WalletSgtOutcome } from "./wallet-types";

const VERIFICATION_TTL_MS = 24 * 60 * 60_000;

export function consumeSgtRateLimit(request: Request, userId: string) {
  return consumeRateLimit({ request, action: "wallet.verify-seeker", ...RATE_LIMITS.seeker, userId });
}

// Only call after consuming an explicit VERIFY_SGT or combined sign-in proof for this address.
export async function refreshWalletSgtVerification(userId: string, address: string): Promise<WalletSgtOutcome> {
  const wallet = await prisma.wallet.findFirst({ where: { userId, address } });
  if (!wallet) throw new AppError("Link the wallet before Seeker verification.", 404, "WALLET_NOT_LINKED");
  // Never extend a cached result, including during ordinary sign-in. Every refresh reads the chain.
  const result = await verifySeekerGenesisOwnership(address);
  const verifiedAt = new Date();
  const expiresAt = result.verified ? new Date(verifiedAt.getTime() + VERIFICATION_TTL_MS) : null;
  try {
    await prisma.$transaction(async (tx) => {
      if (result.verified) {
        const existingMint = await tx.wallet.findUnique({ where: { seekerGenesisMintAddress: result.mintAddress } });
        if (existingMint && existingMint.id !== wallet.id && existingMint.userId !== userId &&
          existingMint.seekerGenesisVerificationExpiresAt && existingMint.seekerGenesisVerificationExpiresAt > verifiedAt) {
          throw new AppError("This Seeker Genesis Token already verifies another tester account.", 409, "SGT_ALREADY_ASSIGNED");
        }
        if (existingMint && existingMint.id !== wallet.id) {
          await tx.wallet.update({ where: { id: existingMint.id }, data: {
            seekerGenesisVerifiedAt: null, seekerGenesisVerificationExpiresAt: null, seekerGenesisMintAddress: null,
          } });
        }
      }
      await tx.wallet.update({ where: { id: wallet.id, userId, address }, data: result.verified ? {
        seekerGenesisVerifiedAt: verifiedAt, seekerGenesisVerificationExpiresAt: expiresAt, seekerGenesisMintAddress: result.mintAddress,
      } : {
        seekerGenesisVerifiedAt: null, seekerGenesisVerificationExpiresAt: null, seekerGenesisMintAddress: null,
      } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("This Seeker Genesis Token already verifies another tester account.", 409, "SGT_ALREADY_ASSIGNED");
    }
    throw error;
  }
  if (result.verified) {
    try { await reconcilePendingInviteGrants(userId); }
    catch (error) { logger.error("wallet.invite_reconciliation_failed", { error, userId }); }
  }
  return { ...result, status: result.verified ? "verified" : "not_found", expiresAt };
}

export function walletSgtFailure(error: unknown): WalletSgtOutcome {
  if (error instanceof SeekerVerificationUnavailableError) {
    return { status: "unavailable", verified: false, mintAddress: null, expiresAt: null,
      code: "SGT_RPC_UNAVAILABLE", message: error.message };
  }
  if (error instanceof AppError) {
    return { status: error.code === "SGT_ALREADY_ASSIGNED" ? "conflict" : error.code === "RATE_LIMITED" ? "rate_limited" : "error",
      verified: false, mintAddress: null, expiresAt: null, code: error.code, message: error.message };
  }
  logger.error("wallet.sgt_verification_failed", { error });
  return { status: "error", verified: false, mintAddress: null, expiresAt: null,
    code: "SGT_CHECK_FAILED", message: "SGT ownership could not be checked. Your wallet sign-in succeeded; retry the SGT check explicitly." };
}

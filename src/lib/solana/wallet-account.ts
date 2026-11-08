import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { AppError } from "@/src/lib/errors";
import { getServerEnv } from "@/src/lib/env";
import { transferAnonymousAccountInTransaction } from "@/src/lib/account-linking";
import { isTransactionConflict, isUniqueConstraintError } from "@/src/lib/prisma-errors";
import { verifySolanaSignature } from "@/src/lib/solana/wallet";
import type { WalletAuthPurpose } from "./wallet-types";

type WalletProof = { challengeId: string; address: string; signature: string; currentUserId: string | null; purpose?: WalletAuthPurpose };

export async function continueWalletAccount(input: WalletProof) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Serialize first-time sign-ins for one address, including separate guest sessions.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-auth:${input.address}`}, 0))`;
        const challenge = await tx.walletChallenge.findUnique({ where: { id: input.challengeId } });
        if (!challenge || challenge.address !== input.address || challenge.purpose !== (input.purpose ?? "SIGN_IN")) {
          throw new AppError("Wallet sign-in challenge not found.", 400, "CHALLENGE_NOT_FOUND");
        }
        if (challenge.userId !== input.currentUserId) {
          throw new AppError("Your session changed. Please try again.", 409, "SESSION_CHANGED");
        }
        if (challenge.usedAt || challenge.expiresAt <= new Date()) {
          throw new AppError("Wallet sign-in challenge expired or was already used.", 400, "CHALLENGE_USED");
        }
        const origin = new URL(getServerEnv().BETTER_AUTH_URL);
        let valid = false;
        try {
          valid = challenge.message.startsWith(`${origin.host} wants you to sign in with your Solana account:\n`) &&
            challenge.message.includes(`\nURI: ${origin.origin}\n`) &&
            verifySolanaSignature({ address: input.address, message: challenge.message, signature: bs58.decode(input.signature) });
        } catch { /* Malformed signatures are authentication failures, never server errors. */ }
        if (!valid) throw new AppError("Invalid wallet signature.", 400, "INVALID_WALLET_SIGNATURE");

        const wallet = await tx.wallet.findUnique({ where: { address: input.address } });
        const ids = [...new Set([input.currentUserId, wallet?.userId].filter((id): id is string => Boolean(id)))].sort();
        if (ids.length) {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
        }
        const current = input.currentUserId ? await tx.user.findUnique({ where: { id: input.currentUserId } }) : null;
        if (input.currentUserId && !current) throw new AppError("Your session changed. Please try again.", 409, "SESSION_CHANGED");
        if (wallet && current && !current.isAnonymous && wallet.userId !== current.id) {
          throw new AppError("This wallet belongs to another SeekerHub account. Sign out first to recover that account; your accounts will not be merged.", 409, "ACCOUNT_SWITCH_REQUIRED");
        }
        // Lock identities before consuming a proof: merging deletes every guest challenge.
        // The opposite order deadlocks two different wallets recovering the same guest.
        const used = await tx.walletChallenge.updateMany({
          where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (!used.count) throw new AppError("Wallet challenge already used or expired.", 400, "CHALLENGE_USED");

        const target = wallet
          ? await tx.user.findUniqueOrThrow({ where: { id: wallet.userId } })
          : current ?? await tx.user.create({ data: {
              name: "Wallet tester", email: `wallet-${randomUUID()}@seekerhub.local`, emailVerified: false, isAnonymous: false,
            } });
        if (!wallet) {
          await tx.wallet.create({ data: {
            userId: target.id, address: input.address, verifiedAt: new Date(),
            isPrimary: !(await tx.wallet.findFirst({ where: { userId: target.id }, select: { id: true } })),
          } });
        }
        const mergedGuestId = current?.isAnonymous && current.id !== target.id ? current.id : null;
        if (mergedGuestId) await transferAnonymousAccountInTransaction(tx, mergedGuestId, target.id);
        const user = target.isAnonymous
          ? await tx.user.update({ where: { id: target.id }, data: { isAnonymous: false } })
          : target;

        if (mergedGuestId) await tx.user.delete({ where: { id: mergedGuestId } });
        await tx.auditLog.create({ data: {
          actorUserId: user.id, action: wallet ? "tester.account_recovered_wallet" : "tester.account_upgraded_wallet",
          targetType: "User", targetId: user.id,
        } });
        return user;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt < 3 && (isTransactionConflict(error) || isUniqueConstraintError(error))) continue;
      throw error;
    }
  }
}

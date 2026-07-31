import bs58 from "bs58";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { transferAnonymousAccount } from "@/src/lib/account-linking";
import { prisma } from "@/src/lib/db";
import { verifySolanaSignature } from "@/src/lib/solana/wallet";
import { solanaAddressSchema } from "@/src/lib/validation";

export function solanaWalletAuthPlugin() {
  return {
    id: "solana-wallet-auth",
    endpoints: {
      signInSolanaWallet: createAuthEndpoint(
        "/sign-in/solana-wallet",
        {
          method: "POST",
          requireRequest: true,
          body: z.object({
            challengeId: z.string().cuid(),
            address: solanaAddressSchema,
            signature: z.string().min(40),
          }),
        },
        async (ctx) => {
          const currentSession = await getSessionFromCtx(ctx, { disableRefresh: true });
          const challenge = await prisma.walletChallenge.findUnique({ where: { id: ctx.body.challengeId } });
          if (!challenge || challenge.address !== ctx.body.address || challenge.purpose !== "SIGN_IN") {
            throw new APIError("BAD_REQUEST", { message: "Wallet sign-in challenge not found." });
          }
          if (challenge.usedAt || challenge.expiresAt <= new Date()) {
            throw new APIError("BAD_REQUEST", { message: "Wallet sign-in challenge expired or was already used." });
          }
          if (
            !verifySolanaSignature({
              address: ctx.body.address,
              message: challenge.message,
              signature: bs58.decode(ctx.body.signature),
            })
          ) {
            throw new APIError("BAD_REQUEST", { message: "Invalid wallet signature." });
          }

          const claimed = await prisma.walletChallenge.updateMany({
            where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } },
            data: { usedAt: new Date() },
          });
          if (!claimed.count) {
            throw new APIError("BAD_REQUEST", { message: "Wallet sign-in challenge expired or was already used." });
          }

          let wallet = await prisma.wallet.findUnique({ where: { address: ctx.body.address } });
          if (!wallet && !currentSession) {
            throw new APIError("NOT_FOUND", { message: "No SeekerHub tester account is linked to this wallet." });
          }
          if (!wallet && currentSession) {
            wallet = await prisma.wallet.create({
              data: {
                userId: currentSession.user.id,
                address: ctx.body.address,
                verifiedAt: new Date(),
                isPrimary: !(await prisma.wallet.findFirst({ where: { userId: currentSession.user.id } })),
              },
            });
          }

          const targetUserId = wallet!.userId;
          if (currentSession?.user.isAnonymous && currentSession.user.id !== targetUserId) {
            await transferAnonymousAccount(currentSession.user.id, targetUserId);
          }

          const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
          if (targetUser?.isAnonymous) {
            await prisma.$transaction([
              prisma.user.update({ where: { id: targetUserId }, data: { isAnonymous: false } }),
              prisma.auditLog.create({
                data: {
                  actorUserId: targetUserId,
                  action: "tester.account_recovered_wallet",
                  targetType: "User",
                  targetId: targetUserId,
                },
              }),
            ]);
          }

          const user = await prisma.user.findUnique({ where: { id: targetUserId } });
          if (!user) throw new APIError("NOT_FOUND", { message: "Wallet account not found." });
          const newSession = await ctx.context.internalAdapter.createSession(targetUserId);
          if (!newSession) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Unable to create wallet session." });

          await setSessionCookie(ctx, { session: newSession, user });

          if (currentSession?.user.isAnonymous && currentSession.user.id !== targetUserId) {
            await prisma.user.delete({ where: { id: currentSession.user.id } }).catch(() => undefined);
          }

          return ctx.json({ success: true, token: newSession.token, user });
        },
      ),
    },
  };
}

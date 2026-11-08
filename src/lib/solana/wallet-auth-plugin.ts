import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { AppError } from "@/src/lib/errors";
import { logger } from "@/src/lib/logger";
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";
import { continueWalletAccount } from "@/src/lib/solana/wallet-account";
import { solanaAddressSchema } from "@/src/lib/validation";
import { consumeSgtRateLimit, refreshWalletSgtVerification, walletSgtFailure } from "./sgt-verification";
import type { WalletSgtOutcome } from "./wallet-types";

export function solanaWalletAuthPlugin() {
  return {
    id: "solana-wallet-auth",
    endpoints: {
      signInSolanaWallet: createAuthEndpoint("/sign-in/solana-wallet", {
        method: "POST", requireRequest: true,
        body: z.object({ challengeId: z.string().cuid(), address: solanaAddressSchema, signature: z.string().min(40).max(128),
          purpose: z.enum(["SIGN_IN", "SIGN_IN_AND_VERIFY_SGT"]).default("SIGN_IN") }),
      }, async (ctx) => {
        const currentSession = await getSessionFromCtx(ctx, { disableRefresh: true });
        let user;
        try {
          user = await continueWalletAccount({ ...ctx.body, currentUserId: currentSession?.user.id ?? null });
        } catch (error) {
          if (error instanceof AppError) {
            throw new APIError(error.status === 409 ? "CONFLICT" : "BAD_REQUEST", { message: error.message, code: error.code });
          }
          logger.error("wallet.continue_failed", { error });
          throw new APIError("INTERNAL_SERVER_ERROR", { message: "Unable to continue with this wallet. Please try again." });
        }
        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Unable to create wallet session. Please try again." });
        await setSessionCookie(ctx, { session, user });
        let sgt: WalletSgtOutcome | undefined;
        if (ctx.body.purpose === "SIGN_IN_AND_VERIFY_SGT") {
          // Proof consumption and account recovery commit before this independent RPC side effect.
          try {
            await consumeSgtRateLimit(ctx.request!, user.id);
            sgt = await refreshWalletSgtVerification(user.id, ctx.body.address);
          } catch (error) { sgt = walletSgtFailure(error); }
        }
        // Authentication must remain recoverable if a separate seat reconciliation transiently fails.
        if (!sgt?.verified) {
          try { await reconcilePendingInviteGrants(user.id); }
          catch (error) { logger.error("wallet.invite_reconciliation_failed", { error, userId: user.id }); }
        }
        return ctx.json({ success: true, user, ...(sgt ? { sgt } : {}) });
      }),
    },
  };
}

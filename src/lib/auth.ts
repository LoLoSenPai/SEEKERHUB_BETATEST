import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { anonymous, magicLink } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/src/lib/db";
import { getServerEnv } from "@/src/lib/env";
import { sendTransactionalEmail } from "@/src/lib/email";
import { transferAnonymousAccount } from "@/src/lib/account-linking";
import { hashedAuthRateLimitStorage } from "@/src/lib/auth-rate-limit";
import { solanaWalletAuthPlugin } from "@/src/lib/solana/wallet-auth-plugin";

const env = getServerEnv();

export const auth = betterAuth({
  appName: "SeekerHub",
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.BETTER_AUTH_URL],
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendTransactionalEmail({
        to: user.email,
        subject: "Reset your SeekerHub password",
        text: "Use this secure link to choose a new password.",
        actionLabel: "Reset password",
        actionUrl: url,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendTransactionalEmail({
        to: user.email,
        subject: "Verify your SeekerHub email",
        text: "Verify this email address before publishing private Android builds.",
        actionLabel: "Verify email",
        actionUrl: url,
      });
    },
  },
  rateLimit: {
    enabled: true,
    customStorage: hashedAuthRateLimitStorage,
    window: 15 * 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 15 * 60, max: 5 },
      "/sign-up/email": { window: 15 * 60, max: 5 },
      "/request-password-reset": { window: 15 * 60, max: 5 },
      "/send-verification-email": { window: 15 * 60, max: 5 },
    },
  },
  plugins: [
    anonymous({
      emailDomainName: "seekerhub.local",
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await transferAnonymousAccount(anonymousUser.user.id, newUser.user.id);
      },
    }),
    magicLink({
      expiresIn: 15 * 60,
      rateLimit: { window: 15 * 60, max: 5 },
      sendMagicLink: async ({ email, url }) => {
        await sendTransactionalEmail({
          to: email,
          subject: "Your SeekerHub sign-in link",
          text: "Open this link to recover your tester access on this device.",
          actionLabel: "Continue to SeekerHub",
          actionUrl: url,
        });
      },
    }),
    solanaWalletAuthPlugin(),
    nextCookies(),
  ],
});

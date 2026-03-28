import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { anonymous } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/src/lib/db";
import { getServerEnv } from "@/src/lib/env";

const env = getServerEnv();

export const auth = betterAuth({
  appName: "SeekerHub",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  plugins: [
    anonymous({
      emailDomainName: "seekerhub.local",
    }),
    nextCookies(),
  ],
});

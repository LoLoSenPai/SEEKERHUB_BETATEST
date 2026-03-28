"use client";

import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";
import { getClientEnv } from "@/src/lib/env";

const env = getClientEnv();
const browserOrigin = typeof window !== "undefined" ? window.location.origin : env.NEXT_PUBLIC_APP_URL;

export const authClient = createAuthClient({
  baseURL: browserOrigin,
  plugins: [anonymousClient()],
});

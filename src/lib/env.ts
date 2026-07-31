import { z } from "zod";

const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/seekerhub";
const DEFAULT_APP_URL = "http://localhost:3000";
const DEFAULT_SOLANA_RPC_URL = "http://127.0.0.1:8899";

function configuredValue(name: string, fallback?: string) {
  const value = process.env[name];
  if (value?.trim()) return value;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} must be configured in production.`);
  return fallback;
}

function configuredPublicValue(name: string, value: string | undefined, fallback: string) {
  if (value?.trim()) return value;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} must be configured in production.`);
  return fallback;
}

export function parseEnvBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  throw new Error(`Invalid boolean environment value: ${String(value)}`);
}

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.boolean(),
  SOLANA_RPC_URL: z.string().url(),
  HELIUS_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  EMAIL_REPLY_TO: z.string().email().optional(),
  INVITE_ENCRYPTION_KEY: z.string().min(32).optional(),
  RATE_LIMIT_SALT: z.string().min(16).optional(),
  ADMIN_EMAILS: z.array(z.string().email()),
  CRON_SECRET: z.string().min(24).optional(),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SOLANA_RPC_URL: z.string().url(),
});

type ServerEnv = z.infer<typeof serverEnvSchema>;
type ClientEnv = z.infer<typeof clientEnvSchema>;

let serverEnvCache: ServerEnv | null = null;
const clientEnvCache: ClientEnv = clientEnvSchema.parse({
  // Next.js only exposes public variables to the browser when they are referenced statically.
  NEXT_PUBLIC_APP_URL: configuredPublicValue(
    "NEXT_PUBLIC_APP_URL",
    process.env.NEXT_PUBLIC_APP_URL,
    DEFAULT_APP_URL,
  ),
  NEXT_PUBLIC_SOLANA_RPC_URL: configuredPublicValue(
    "NEXT_PUBLIC_SOLANA_RPC_URL",
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    DEFAULT_SOLANA_RPC_URL,
  ),
});

export function getServerEnv() {
  if (!serverEnvCache) {
    serverEnvCache = serverEnvSchema.parse({
      DATABASE_URL: configuredValue("DATABASE_URL", DEFAULT_DATABASE_URL),
      DIRECT_DATABASE_URL: configuredValue("DIRECT_DATABASE_URL"),
      BETTER_AUTH_SECRET: configuredValue("BETTER_AUTH_SECRET", "development-only-better-auth-secret-000"),
      BETTER_AUTH_URL: configuredValue(
        "BETTER_AUTH_URL",
        process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL,
      ),
      S3_ENDPOINT: configuredValue("S3_ENDPOINT", "http://127.0.0.1:9000"),
      S3_REGION: configuredValue("S3_REGION", "us-east-1"),
      S3_BUCKET: configuredValue("S3_BUCKET", "seekerhub-builds"),
      S3_ACCESS_KEY_ID: configuredValue("S3_ACCESS_KEY_ID", "minioadmin"),
      S3_SECRET_ACCESS_KEY: configuredValue("S3_SECRET_ACCESS_KEY", "minioadmin"),
      S3_FORCE_PATH_STYLE: parseEnvBoolean(configuredValue("S3_FORCE_PATH_STYLE", "true"), true),
      SOLANA_RPC_URL: configuredValue("SOLANA_RPC_URL", DEFAULT_SOLANA_RPC_URL),
      HELIUS_API_KEY: process.env.HELIUS_API_KEY,
      RESEND_API_KEY: configuredValue("RESEND_API_KEY"),
      EMAIL_FROM: configuredValue("EMAIL_FROM"),
      EMAIL_REPLY_TO: configuredValue("EMAIL_REPLY_TO"),
      INVITE_ENCRYPTION_KEY: configuredValue("INVITE_ENCRYPTION_KEY"),
      RATE_LIMIT_SALT: configuredValue("RATE_LIMIT_SALT"),
      ADMIN_EMAILS: (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
      CRON_SECRET: configuredValue("CRON_SECRET"),
    });
    if (process.env.NODE_ENV === "production" && serverEnvCache.ADMIN_EMAILS.length === 0) {
      throw new Error("ADMIN_EMAILS must include at least one administrator in production.");
    }
  }

  return serverEnvCache;
}

export function requireProductionSecret<K extends keyof ServerEnv>(key: K) {
  const value = getServerEnv()[key];
  if (process.env.NODE_ENV === "production" && !value) {
    throw new Error(`${key} must be configured in production.`);
  }
  return value;
}

export function getClientEnv() {
  return clientEnvCache;
}

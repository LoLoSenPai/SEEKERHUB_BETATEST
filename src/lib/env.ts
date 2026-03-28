import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@127.0.0.1:5432/seekerhub"),
  DIRECT_DATABASE_URL: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(32).default("development-only-better-auth-secret-000"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  S3_ENDPOINT: z.string().url().default("http://127.0.0.1:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1).default("seekerhub-builds"),
  S3_ACCESS_KEY_ID: z.string().min(1).default("minioadmin"),
  S3_SECRET_ACCESS_KEY: z.string().min(1).default("minioadmin"),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),
  HELIUS_API_KEY: z.string().optional(),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),
});

type ServerEnv = z.infer<typeof serverEnvSchema>;
type ClientEnv = z.infer<typeof clientEnvSchema>;

let serverEnvCache: ServerEnv | null = null;
const clientEnvCache: ClientEnv = clientEnvSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  NEXT_PUBLIC_SOLANA_RPC_URL:
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
});

export function getServerEnv() {
  if (!serverEnvCache) {
    serverEnvCache = serverEnvSchema.parse({
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/seekerhub",
      DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "development-only-better-auth-secret-000",
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000",
      S3_REGION: process.env.S3_REGION ?? "us-east-1",
      S3_BUCKET: process.env.S3_BUCKET ?? "seekerhub-builds",
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
      S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? "true",
      SOLANA_RPC_URL: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
      HELIUS_API_KEY: process.env.HELIUS_API_KEY,
    });
  }

  return serverEnvCache;
}

export function getClientEnv() {
  return clientEnvCache;
}

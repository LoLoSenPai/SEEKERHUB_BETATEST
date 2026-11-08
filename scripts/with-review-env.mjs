// Isolated local QA. Never inherit production service credentials from .env.
import { spawn } from "node:child_process";

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error("Usage: node scripts/with-review-env.mjs <node entrypoint> [...args]");
const port = Number(process.env.REVIEW_PORT ?? 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("REVIEW_PORT must be a local port between 1024 and 65535.");
const baseUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  DATABASE_URL: "postgresql://postgres:review-local-only@127.0.0.1:5437/seekerhub_redesign_test",
  DIRECT_DATABASE_URL: "postgresql://postgres:review-local-only@127.0.0.1:5437/seekerhub_redesign_test",
  BETTER_AUTH_URL: baseUrl,
  NEXT_PUBLIC_APP_URL: baseUrl,
  BETTER_AUTH_SECRET: "review-only-better-auth-secret-not-production",
  INVITE_ENCRYPTION_KEY: "review-invite-encryption-key-000000000000",
  RATE_LIMIT_SALT: "review-rate-limit-salt-000000000000",
  CRON_SECRET: "review-cron-secret-0000000000000000",
  ADMIN_EMAILS: "admin@example.com",
  S3_ENDPOINT: "http://127.0.0.1:9007",
  S3_REGION: "us-east-1",
  S3_BUCKET: "seekerhub-redesign-test",
  S3_ACCESS_KEY_ID: "review-minio",
  S3_SECRET_ACCESS_KEY: "review-local-only",
  S3_FORCE_PATH_STYLE: "true",
  SOLANA_RPC_URL: "http://127.0.0.1:8899",
  NEXT_PUBLIC_SOLANA_RPC_URL: "http://127.0.0.1:8899",
  NEXT_PUBLIC_SEEKER_RELAY_DOMAIN: "",
  NEXT_PUBLIC_ENABLE_SEEKER_CONNECT: "false",
  HELIUS_API_KEY: "",
  RESEND_API_KEY: "re_local_disabled",
  EMAIL_FROM: "SeekerHub QA <qa@example.test>",
  EMAIL_REPLY_TO: "qa@example.test",
  RUN_INTEGRATION_TESTS: "true",
  PLAYWRIGHT_BASE_URL: baseUrl,
  PLAYWRIGHT_REUSE_SERVER: process.env.REVIEW_REUSE_SERVER === "true" ? "true" : "false",
  VERCEL_URL: "",
  VERCEL: "",
};
const child = spawn(process.execPath, [script, ...args], { env, stdio: "inherit" });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });

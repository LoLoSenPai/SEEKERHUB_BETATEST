// Isolated local QA. Never inherit production service credentials from .env.
import { spawn } from "node:child_process";

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error("Usage: node scripts/with-review-env.mjs <node entrypoint> [...args]");
const baseUrl = "http://127.0.0.1:3100";
const env = {
  ...process.env,
  DATABASE_URL: "postgresql://postgres:review-local-only@127.0.0.1:55432/seekerhub_review_test",
  DIRECT_DATABASE_URL: "postgresql://postgres:review-local-only@127.0.0.1:55432/seekerhub_review_test",
  BETTER_AUTH_URL: baseUrl,
  NEXT_PUBLIC_APP_URL: baseUrl,
  BETTER_AUTH_SECRET: "review-local-only-auth-secret-never-production",
  INVITE_ENCRYPTION_KEY: "review-local-only-invite-key-never-production",
  RATE_LIMIT_SALT: "review-local-only-rate-limit-salt",
  CRON_SECRET: "review-local-only-cron-secret-never-production",
  ADMIN_EMAILS: "review-admin@example.test",
  S3_ENDPOINT: "http://127.0.0.1:59000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "seekerhub-review-test",
  S3_ACCESS_KEY_ID: "reviewlocal",
  S3_SECRET_ACCESS_KEY: "review-local-only-storage",
  S3_FORCE_PATH_STYLE: "true",
  SOLANA_RPC_URL: "http://127.0.0.1:8899",
  NEXT_PUBLIC_SOLANA_RPC_URL: "http://127.0.0.1:8899",
  NEXT_PUBLIC_SEEKER_RELAY_DOMAIN: "",
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

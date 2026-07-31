# SeekerHub Public Beta

SeekerHub is a web-first private Android beta distribution service for Solana Mobile builders. Builders upload signed APKs to private object storage, publish policy-gated releases, invite testers, and collect release-specific feedback. It is not an app store and it does not claim to cryptographically certify APK signatures.

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4
- Better Auth with email/password, verification, password reset, anonymous guests, magic links, and wallet recovery
- Prisma 6 with PostgreSQL (Neon in production)
- S3-compatible private storage (Cloudflare R2 in production, MinIO locally)
- Resend for transactional email
- Solana Mobile Wallet Adapter and server-side Seeker Genesis Token verification

Node.js 24 is required. The repository and Vercel project must use the same major version.

## Local Setup

1. Install dependencies and create the local environment file.

```bash
npm install
cp .env.example .env
```

2. Start PostgreSQL and MinIO. The bootstrap container creates the private `seekerhub-builds` bucket.

```bash
docker compose up -d
```

3. Apply versioned migrations to the local database and start Next.js.

```bash
npm run db:generate
npm run db:migrate
npm run dev
```

Use one canonical local origin, normally `http://127.0.0.1:3000`, for `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, and the browser URL.

## Environment

Required service variables:

- `DATABASE_URL`: pooled PostgreSQL URL used by the application.
- `DIRECT_DATABASE_URL`: direct PostgreSQL URL used by Prisma migrations.
- `BETTER_AUTH_SECRET`: independent auth secret of at least 32 characters.
- `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`: identical canonical application origins.
- `INVITE_ENCRYPTION_KEY`: independent key used for reusable invite URLs. Do not derive it from the auth secret.
- `RATE_LIMIT_SALT`: secret salt used before IP-derived rate-limit keys are stored.
- `ADMIN_EMAILS`: comma-separated emergency/admin allowlist. The migrated original owner is also bootstrapped as admin.
- `CRON_SECRET`: Vercel Cron bearer secret.
- `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`: verified Resend sender configuration.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`.
- `SOLANA_RPC_URL`: server RPC used for Token-2022 SGT verification.
- `NEXT_PUBLIC_SOLANA_RPC_URL`: browser RPC used by wallet adapters.

Production startup fails explicitly when any core service secret, email setting, invite key, rate-limit salt, admin allowlist, or cron secret is missing. `/api/health` then monitors live database, storage, email, cron, and invite-key readiness.

## R2 Setup

Keep the bucket private. The R2 token needs Object Read & Write only for the selected bucket. Configure bucket CORS for the production origin so browsers can use signed `PUT` URLs:

```json
[
  {
    "AllowedOrigins": ["https://your-domain.example"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "content-length"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Upload flow:

1. The server atomically reserves the builder quota.
2. The browser receives a 15-minute signed R2 `PUT` URL bound to content type and size.
3. Finalization verifies R2 `Content-Length`, then streams the object into Vercel temporary storage; it is never buffered entirely in memory.
4. SeekerHub verifies ZIP/APK structure, parses the binary manifest, detects APK signature markers, and computes SHA-256 while streaming.
5. Manifest package/version fields are authoritative and the project is permanently bound to the first package name.
6. Downloads are authorized on every request and redirect to a private 60-second signed attachment URL.

The signature-marker check is not a replacement for Android `apksigner verify`. Full cryptographic verification needs a dedicated Android/Java validation service.

## Database Migrations

Production uses `prisma migrate deploy`; do not use `db push` against Neon.

For a new database:

```bash
npm run db:migrate:deploy
```

The current production database predates Prisma migrations. Before its first migration deployment:

1. Create a Neon backup branch.
2. Point the CLI at that branch and test the sequence there.
3. Mark the generated historical schema as already applied.
4. Deploy the additive hardening migration.

```bash
npx prisma migrate resolve --applied 20260731000000_baseline
npm run db:migrate:deploy
```

Only run those two commands against production after explicit approval and after the Neon branch test passes.

## Identity And Access

- `User` is the common identity for builders and testers.
- `BuilderProfile` grants builder capability, status, quotas, and optional admin access.
- Invite visitors start as guests. Magic-link or wallet recovery transfers claims, memberships, feedback, events, profiles, and wallets transactionally to the recovered account.
- Link expiration/revocation blocks new claims. `TesterAccess` keeps project-level revocation effective across every future invite link; reactivation allows a new claim but never restores an old seat automatically.
- Metadata visibility, APK download, and feedback permission are evaluated separately with typed reason codes.
- Device/browser detection is advisory only. It can never provide Seeker access.
- A Seeker gate requires a fresh wallet signature and a server-side positive-balance Token-2022 SGT check. Verification expires after 24 hours.

Default public-beta quotas are one project, five retained releases, 250 MiB per APK, and 500 MiB physical storage. Trash counts until the seven-day R2 purge completes.

## Operations

- `/admin`: builders, suspension, quotas, storage deletion queue, immediate confirmed purge, and audit log.
- `/api/health`: database, R2, email, cron, and invite-key readiness.
- `/api/cron/cleanup`: releases expired reservations, removes R2 objects, purges database records, and prunes transient records.
- `vercel.json`: daily cleanup schedule.
- `/privacy`, `/terms`: beta legal drafts that must be reviewed before promotion. `/abuse` publishes the monitored `EMAIL_REPLY_TO` contact.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
```

Integration tests require a disposable PostgreSQL database whose name contains `test`, local S3-compatible storage, and `RUN_INTEGRATION_TESTS=true`. The GitHub Actions workflow provisions PostgreSQL 16 and MinIO, applies every migration from a blank database, and runs the complete suite automatically. It never uses the production Neon or R2 connections.

The remaining native `bigint` binding warning comes from a Solana transitive dependency; the package falls back to its JavaScript implementation. Production audit exceptions and mitigations are tracked in `SECURITY.md`. Review them before each public deployment rather than accepting breaking downgrades proposed by `npm audit fix --force`.

## V2

- Dedicated mobile companion for richer native Seeker context
- Android `apksigner` verification service and signer certificate history
- Invite email campaigns and webhook notifications
- Crash/ANR ingestion and feedback attachments
- Release channels, rollback, and organization workspaces
- Stronger analytics deduplication and export

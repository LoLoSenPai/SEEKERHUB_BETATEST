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

See [the beta readiness checkpoint](docs/beta-readiness.md) for the implemented journey changes, local validation and remaining production launch checks.

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
- `SOLANA_RPC_URL`: mainnet server RPC used for Token-2022 SGT verification and primary `.skr` name resolution.
- `NEXT_PUBLIC_SOLANA_RPC_URL`: browser RPC used by wallet adapters.
- `NEXT_PUBLIC_ENABLE_SEEKER_CONNECT`: experimental, defaults to `false`. Keep disabled until the certified HTTPS App Link has been validated on the target wallet/device/browser; otherwise Android can navigate to Solana Mobile instead of opening the wallet. Standard Mobile Wallet Adapter remains the supported Android connection path.
- `NEXT_PUBLIC_SEEKER_RELAY_DOMAIN`: bare relay host, defaults to `relay.solanamobile.com`. Registration additionally requires the opt-in flag, HTTPS and a non-empty relay. The operator accepted the [Solana Mobile relay terms](https://docs.solanamobile.com/solana-mobile-stack/seeker-connect-quickstart); forks must accept independently. These public settings require a rebuild.

Production startup fails explicitly when any core service secret, email setting, invite key, rate-limit salt, admin allowlist, or cron secret is missing. `/api/health` then monitors live database, storage, email, cron, and invite-key readiness.

### Transactional email deliverability

- Send from a dedicated, verified Resend subdomain with SPF and DKIM enabled.
- Publish DMARC on the organizational domain. Start with `p=none`, monitor delivery, then tighten the policy when all senders are aligned.
- Prefer a same-domain reply address over a personal Gmail address. Omit replies until a monitored mailbox exists rather than pointing users to an unattended sender.
- Use a custom application domain under the same organizational domain. Auth links from `app.example.com` sent by `mail.example.com` establish clearer brand alignment than links to a shared hosting domain.
- New domains have no sending reputation. Keep volume gradual and ask internal recipients to mark early transactional messages as not spam; code cannot guarantee inbox placement.

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

1. The server atomically reserves the builder quota, including temporary room for the uploaded and inspected copies (twice the APK size).
2. The browser receives a 15-minute signed R2 `PUT` URL bound to content type and size.
3. Finalization verifies R2 `Content-Length`, then streams the object into Vercel temporary storage; it is never buffered entirely in memory.
4. SeekerHub verifies ZIP/APK structure, parses the bounded binary manifest in a memory/time-limited worker, detects APK signature markers, and computes SHA-256 while streaming.
5. Manifest package/version fields are authoritative and the project is permanently bound to the first package name.
6. The exact inspected local snapshot is saved to a separate server-only object key. The browser PUT URL can never replace this final APK. Its staging copy remains charged until delayed cleanup, including the presigned URL replay window.
7. Finalization saves a **draft**, not a public release. The builder continues with release notes, audience, then a review screen. Publishing atomically saves the policy and creates an invite when required. Retrying publication does not create duplicate links.
8. Downloads are authorized on every request and redirect to a private 60-second signed attachment URL.

Draft APKs survive navigation; unsubmitted notes/audience edits do not. Resume a draft from the app's release list. Invite links default to that release and its required group; app-wide access is an explicit choice. An app-wide link can unlock future eligible releases, whereas "older versions" applies only to earlier builds whose own requirements are also met.

The signature-marker check is not a replacement for Android `apksigner verify`. Full cryptographic verification needs a dedicated Android/Java validation service.

## Database Migrations

Production uses `prisma migrate deploy`; do not use `db push` against Neon.

For a new database:

```bash
npm run db:migrate:deploy
```

For a legacy database that predates Prisma migrations, and only if the baseline is not already recorded:

1. Create a Neon backup branch.
2. Point the CLI at that branch and test the sequence there.
3. Confirm the existing schema matches the baseline, then mark that baseline as already applied.
4. Deploy the additive hardening migration.

```bash
npx prisma migrate resolve --applied 20260731000000_baseline
npm run db:migrate:deploy
```

Only run those two commands against production after explicit approval and after the Neon branch test passes.

## Identity And Access

- `User` is the common identity for builders and testers.
- `BuilderProfile` grants builder capability, status, quotas, and optional admin access.
- Standard invites offer guest access. Wallet-gated invites ask for wallet sign-in first; connecting alone is not authentication. One explicit, domain-bound signature creates a durable tester or recovers the account already owning that address. Reopening an invite while signed in can reuse the current account without another signature.
- Wallet recovery transfers the current guest's claims, memberships, feedback, events, profiles, and wallets transactionally. Duplicate claims collapse to one, preserving revocations. Two established accounts are never silently merged or switched. Wallet authentication grants no builder permissions.
- Link expiration/revocation blocks new claims **and new seat grants** to pending claims. Already granted places are not invalidated by closing a link. `TesterAccess` keeps project-level revocation effective across every future invite link; reactivation allows a new claim but never restores an old seat automatically.
- Metadata visibility, APK download, and feedback permission are evaluated separately with typed reason codes.
- Device/browser detection is advisory only. It can never provide Seeker access.
- A Seeker gate requires a fresh wallet signature and a server-side positive-balance Token-2022 SGT check. Verification expires after 24 hours.
- Wallet access has one connection entry point: standard MWA on Android Chrome, Wallet Standard selection on desktop. The device may open its default wallet directly; the website does not enumerate installed Android wallet apps. Connecting does not sign in: the tester explicitly continues with a signature, and SGT verification remains a separate server-side check regardless of the wallet app.
- Seeker Connect 0.2 uses the official web SDK but remains disabled by default after a physical-device report of its HTTPS App Link opening the website instead of the wallet. Opt-in registration exposes it only through the standard picker, not a separate CTA. Cancellation is normal; dropped requests are never retried automatically. Selecting an adapter is not hardware attestation or an SGT proof.
- `.skr` display names use `@solana-mobile/skr-domain` and the wallet's primary name only. The SDK rechecks ownership/expiry; no primary name means a short-address fallback. The authenticated resolver only handles wallets linked to the caller, with bounded requests, rate limits and a per-instance cache (one hour positive, five minutes negative). Names never authorize access or merge accounts, and RPC failures do not block sign-in/downloads.
- Analytics separate identified accounts from guest browser identities. Recovery deduplicates transferred history by account; an abandoned anonymous session cannot be attributed to a person without a recovery proof. Download links issued count repeated requests, not confirmed installs.

Default public-beta quotas are one project, five retained releases, 250 MiB per APK, and 500 MiB physical storage. Trash counts until the seven-day R2 purge completes.

## Operations

- `/admin`: builders, suspension, quotas, storage deletion queue, immediate confirmed purge, and audit log.
- `/api/health`: database, R2, email, cron, and invite-key readiness.
- `/api/cron/cleanup`: releases expired reservations, removes R2 objects, purges database records, and prunes transient records.
- `vercel.json`: cleanup every ten minutes (Vercel Pro), with bounded batches, retries, and backlog logs. See `SECURITY.md` for operational limits.
- `/privacy`, `/terms`: beta legal drafts that must be reviewed before promotion. `/abuse` publishes the monitored `EMAIL_REPLY_TO` contact.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
npm run test:artifact
```

Integration tests require a disposable PostgreSQL database whose name contains `test`, local S3-compatible storage, and `RUN_INTEGRATION_TESTS=true`. The GitHub Actions workflow provisions PostgreSQL 16 and MinIO, applies every migration from a blank database, and runs the complete suite against the production build. It never uses the production Neon or R2 connections. The artifact check copies only the finalize route's traced files into a temporary directory and executes its APK workers without access to the checkout's dependencies.

For isolated local review, `scripts/with-review-env.mjs` replaces service credentials before running a Node entrypoint. It expects a disposable PostgreSQL database `seekerhub_review_test` on port 55432 and MinIO on 59000; its credentials are test-only. The app/E2E base URL is `http://127.0.0.1:3100`. Never point the suite at production. Example: `node scripts/with-review-env.mjs node_modules/vitest/vitest.mjs run --config vitest.integration.config.mts`. Authenticated browser tests seed verified test accounts locally; they do not establish real email deliverability or physical Android/MWA compatibility.

The remaining native `bigint` binding warning comes from a Solana transitive dependency; the package falls back to its JavaScript implementation. Production audit exceptions and mitigations are tracked in `SECURITY.md`. Review them before each public deployment rather than accepting breaking downgrades proposed by `npm audit fix --force`.

## V2

- Dedicated mobile companion for richer native Seeker context
- Android `apksigner` verification service and signer certificate history
- Invite email campaigns and webhook notifications
- Crash/ANR ingestion and feedback attachments
- Release channels, rollback, and organization workspaces
- Stronger analytics deduplication and export

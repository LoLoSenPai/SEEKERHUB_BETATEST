# SeekerHub MVP

SeekerHub is a web-first private beta distribution platform for Android builders shipping to Solana Seeker and Android users before official store publication.

It covers:

- builder authentication
- app/project creation
- signed APK release uploads
- private invite links
- tester groups and wallet-aware access
- tester dashboard and private downloads
- feedback per release
- simple release analytics
- Seeker-aware device context from day one

## Stack

- Next.js 16 App Router
- TypeScript
- Tailwind CSS v4
- Better Auth
- Prisma
- PostgreSQL
- S3-compatible private object storage
- Solana wallet adapter for web/mobile wallet flows

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template:

```bash
cp .env.example .env
```

3. Start local infrastructure:

```bash
docker compose up -d
```

4. Generate Prisma client and push the schema:

```bash
npm run db:generate
npm run db:push
```

5. Start the app:

```bash
npm run dev
```

The default local app URL is `http://localhost:3000`.

## Environment Variables

`DATABASE_URL`
PostgreSQL connection string used by Prisma and Better Auth.

`BETTER_AUTH_SECRET`
Secret used to sign auth cookies and tokens.

`BETTER_AUTH_URL`
Canonical server URL for Better Auth.

`NEXT_PUBLIC_APP_URL`
Public app URL used by the wallet layer and generated invite links.

`S3_ENDPOINT`
S3-compatible endpoint. For local MinIO: `http://127.0.0.1:9000`.

`S3_REGION`
Storage region. Local MinIO can still use `us-east-1`.

`S3_BUCKET`
Private bucket name for APK assets.

`S3_ACCESS_KEY_ID`
Access key for object storage.

`S3_SECRET_ACCESS_KEY`
Secret key for object storage.

`S3_FORCE_PATH_STYLE`
Use `true` for MinIO and many local S3-compatible targets.

`SOLANA_RPC_URL`
Server-side Solana RPC endpoint used for wallet verification and optional Seeker Genesis Token verification.

`NEXT_PUBLIC_SOLANA_RPC_URL`
Client-side RPC endpoint used by the wallet adapter.

`HELIUS_API_KEY`
Optional. Reserved for future Helius-based enhancements. The MVP Seeker verification path works with standard RPC.

## Database Setup

Prisma schema lives in [prisma/schema.prisma](/e:/CODE/PERSO/SEEKERHUB_BETATEST/prisma/schema.prisma).

Core domain models:

- `User`, `Session`, `Account`, `Verification` for Better Auth
- `AppProject`
- `Release`
- `BuildAsset`
- `InviteLink`
- `InviteClaim`
- `TesterGroup`
- `TesterMembership`
- `AccessPolicy`
- `AccessPolicyWalletEntry`
- `DeviceProfile`
- `DownloadEvent`
- `ReleaseViewEvent`
- `FeedbackReport`
- `Wallet`
- `WalletChallenge`
- `ReleaseUploadSession`

Useful commands:

```bash
npm run db:generate
npm run db:push
npm run db:migrate
npm run db:studio
```

## Storage Setup

The app never assumes local disk as the source of truth for APK storage.

Storage flow:

1. Builder creates an upload session.
2. The server returns a short-lived signed `PUT` URL.
3. The browser uploads the APK directly to private object storage.
4. The finalize endpoint downloads the stored object server-side, validates the APK structure, computes `SHA-256`, and persists metadata.
5. Tester downloads always go through an authorized route that returns a short-lived signed `GET` URL.

For local development, `docker-compose.yml` starts:

- PostgreSQL on `5432`
- MinIO API on `9000`
- MinIO console on `9001`
- a one-shot bucket bootstrap container creating the `seekerhub-builds` bucket

## Local Development

Run lint:

```bash
npm run lint
```

Run unit tests:

```bash
npm test
```

Run the Playwright smoke check:

```bash
npm run test:e2e
```

When you no longer need local file uploads, you can stop Docker:

```bash
docker compose down
```

## Production Deployment

Recommended production stack:

- Vercel for the Next.js app
- Neon for PostgreSQL
- Cloudflare R2 for APK storage

Why this fits SeekerHub well:

- the app already uses signed S3-compatible uploads and downloads
- R2 drops into the current storage abstraction cleanly
- Neon keeps the Prisma/PostgreSQL stack intact
- Vercel is a good fit for the App Router pages and route handlers

### Production Environment Variables

Set these in Vercel Project Settings -> Environment Variables.

```bash
DATABASE_URL="postgresql://<user>:<password>@<pooled-neon-host>/<db>?sslmode=require&channel_binding=require"
DIRECT_DATABASE_URL="postgresql://<user>:<password>@<direct-neon-host>/<db>?sslmode=require&channel_binding=require"
BETTER_AUTH_SECRET="<long-random-secret-at-least-32-chars>"
BETTER_AUTH_URL="https://your-domain.vercel.app"
NEXT_PUBLIC_APP_URL="https://your-domain.vercel.app"

S3_ENDPOINT="https://<cloudflare-account-id>.r2.cloudflarestorage.com"
S3_REGION="auto"
S3_BUCKET="seekerhub-builds"
S3_ACCESS_KEY_ID="<r2-access-key-id>"
S3_SECRET_ACCESS_KEY="<r2-secret-access-key>"
S3_FORCE_PATH_STYLE="false"

SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=<your-key>"
NEXT_PUBLIC_SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=<your-key>"
HELIUS_API_KEY="<your-key>"
```

Notes:

- `DATABASE_URL` should use the pooled Neon connection string for runtime traffic.
- `DIRECT_DATABASE_URL` should use the non-pooled direct Neon connection string for Prisma CLI commands like `db push` and `migrate`.
- `S3_FORCE_PATH_STYLE` should stay `false` for Cloudflare R2.
- `S3_REGION` should be `auto` for Cloudflare R2.

### Deployment Order

1. Create a Neon project and copy both connection strings:
   - pooled connection string -> `DATABASE_URL`
   - direct connection string -> `DIRECT_DATABASE_URL`
2. Create a Cloudflare R2 bucket named `seekerhub-builds`.
3. Create an R2 API token / access key pair with read and write access to that bucket.
4. Add all environment variables to Vercel.
5. Deploy the app to Vercel.
6. Run Prisma against the Neon database:

```bash
npm install
npm run db:generate
npm run db:push
```

Run those commands from your machine with the production `DATABASE_URL` and `DIRECT_DATABASE_URL` loaded in the environment, or from a secure CI step.

### What Changes After Deployment

- APK uploads no longer touch your laptop or local Docker containers.
- The browser uploads directly to Cloudflare R2 using short-lived signed URLs.
- Release finalization runs in the deployed Next.js backend.
- PostgreSQL data lives in Neon instead of your local Postgres container.
- Docker remains optional and only useful for local fallback development.

## Seeker Detection Integration

Seeker support is intentionally split into two layers.

Web core:

- `useDeviceContext()` computes a privacy-safe device context.
- It exposes:
  - `isSeeker`
  - `isSolanaMobileCapable`
  - `hasMobileWalletAdapterContext`
  - `recognitionSource`
  - normalized browser / OS / device class fields
- On the web MVP, Seeker detection is conservative:
  - Solana Mobile capability is inferred from browser context
  - `isSeeker` becomes hard-true only when wallet verification proves Seeker Genesis ownership

Optional stricter path:

- linked wallets can be verified server-side against Seeker Genesis Token rules
- release policies can require:
  - linked wallet
  - Solana Mobile capable device
  - verified Seeker wallet

Relevant files:

- [src/features/seeker/use-device-context.ts](/e:/CODE/PERSO/SEEKERHUB_BETATEST/src/features/seeker/use-device-context.ts)
- [src/lib/device/detect.ts](/e:/CODE/PERSO/SEEKERHUB_BETATEST/src/lib/device/detect.ts)
- [src/lib/solana/sgt.ts](/e:/CODE/PERSO/SEEKERHUB_BETATEST/src/lib/solana/sgt.ts)
- [src/lib/access.ts](/e:/CODE/PERSO/SEEKERHUB_BETATEST/src/lib/access.ts)

## Security Notes

- APK objects are stored privately and never served as public static files.
- Invite links store only hashed tokens in the database.
- Download authorization is re-evaluated server-side on each request.
- Wallet linking uses signed challenge messages.
- Device profiles store only privacy-safe derived context, not raw hardware identifiers.

## V2 Improvements

- dedicated companion mobile app for stronger Seeker-native detection
- email delivery for invite links and auth flows
- richer tester management, manual membership assignment, and revoke flows
- release rollback and channel support
- build integrity metadata beyond SHA-256, including signer certificate inspection
- per-release crash ingestion and attachments in feedback reports
- webhook integrations for builder notifications
- Helius-backed analytics and Seeker ecosystem enrichment

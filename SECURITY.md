# Security Policy

## Reporting

Do not publish suspected vulnerabilities in a public issue. Use the monitored contact shown on `/abuse` so reports can be triaged privately.

## Dependency Gate

`npm run audit:production` blocks every high or critical production finding, without exceptions. A registry failure or incomplete report also fails the check. A clean dependency audit is not a guarantee that the application has no vulnerabilities.

Updated Next.js and matching ESLint config to 16.4.3, Better Auth to 1.7.14, and React/React DOM to 19.2.9. Removed the obsolete Sharp override: Next now requires patched Sharp ^0.35.5. Relevant upstream notices: [Next image optimizer](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw), [Sharp librsvg](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), [Better Auth token confusion](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm), [React patch](https://github.com/facebook/react/releases/tag/v19.2.9).

On 2026-11-23, updated Next.js and its ESLint config to [16.4.6](https://github.com/vercel/next.js/releases/tag/v16.4.6) for the seven moderate Next.js advisories affecting versions through 16.4.4. No audit exceptions or application configuration changes were needed.

The override `@prisma/config -> deepmerge-ts@8.0.2` addresses [recursive object exhaustion](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx). Prisma 6.19.3 imports the unchanged named `deepmerge` API exclusively for local configuration loading (remote config extension is disabled). Prisma generation, validation and local config loading must remain working. This avoids an unrelated Prisma/schema major migration. Remove the override when the supported Prisma line includes the fix.

Prisma 6.19.3 pins `effect@3.21.0` through `@prisma/config`. Override only that dependency to `3.22.1`, the patched release for [GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw). Remove the override when the supported Prisma version resolves a patched Effect without it. This is a dependency fix, not an audit exception.

Better Auth 1.7's custom rate-limit storage requires only atomic `consume`; the adapter keeps its HMAC keys and conditional database writes, removing obsolete `get`/`set` hooks rather than restoring a racy fallback.

### Wallet and SGT Dependencies

- The server uses the official `@solana-program/token-2022` codecs rather than legacy `@solana/spl-token`. This removes [bigint-buffer](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), its native conversion path and the corresponding exceptions. Wallet login, signatures and the adapters do not require this decoder. The SGT tests include both a genuine mint and a non-SGT Token-2022 mint from Solana Mobile's public fixtures.
- The React Native peer tooling uses Metro 0.84.6, within its declared range. [Metro switched image parsers in 0.84.5](https://github.com/react/metro/releases/tag/v0.84.5), removing `image-size` without overriding its incompatible API or omitting native peers.
- Only `@solana/web3.js@1.98.4 -> jayson` is overridden to 5.0.0. Web3 imports Jayson's browser HTTP client, not its streaming transports. This removes the old `stream-json` and `uuid@8` dependencies. Node 24 and supported HTTPS browsers provide Web Crypto for request IDs. The loopback RPC regression test covers ID generation, success and error propagation; wallet E2E tests cover desktop and Android browser flows. Remove the override when Web3 supports a patched transport directly; recheck this contract before changing either version.

## Cleanup Operations

`/api/cron/cleanup` requires `CRON_SECRET`. It runs hourly: expired reservations and eligible deletions are picked up on a subsequent run, not immediately. Each run processes at most four 25-row batches each for expired reservations and storage tasks. New reservation work stops after 20 seconds and deletion work after a shared 40-second budget; S3 deletion is abortable within ten seconds or the remaining budget. Database calls and final bookkeeping may extend beyond that work budget; the function ceiling is 60 seconds. Auxiliary retention deletes are bounded to 25 projects/orphan releases and 500 rows per other table per invocation. No schema migration is required.

Task claims compare the observed `updatedAt` and `attempts`. PROCESSING leases expire after 15 minutes, longer than the function lifetime; completion and failure updates are fenced to that exact claim. Failed work is rescheduled with exponential delays of 5/10/20/40 minutes, with five automatic attempts total. A crash during the final attempt becomes an exhausted FAILED task after lease expiry rather than remaining PROCESSING forever. Deletion is idempotent; quota decrement and task completion share a database transaction. Unknown/active resources are rejected before S3 deletion.

Upload cleanup shares `inspectedApkKey` and `uploadCleanupAt` with finalization. `UploadStaging` is valid for a completed session; `UploadFinal` is rejected if it is completed or referenced by a BuildAsset. The worker waits until presign expiry plus a one-hour replay/in-flight grace period and until finalization's lease is stale. All remaining reserved bytes stay charged until every staging/orphan-final deletion task is physically completed. A session-row lock serializes settlement of the two objects; legacy already-released `UploadSession` tasks cannot decrement quota a second time. Completed sessions remain available for idempotent finalize replies. Project pruning excludes sessions with unsettled reservations.

Structured `cleanup.completed` logs include counts, due/deferred/processing/exhausted backlog and oldest due age. `cleanup.manual_review_required` is an error event for exhausted tasks; operators should alert on it and on growing oldest due age. Review the existing admin purge workflow for exhausted tasks; it is not an automatic unlimited retry loop. No cleanup invocation against production is part of local validation.

The ten-minute schedule requires Vercel Pro/Enterprise: [Hobby only supports daily cron](https://vercel.com/docs/cron-jobs/usage-and-pricing). On Hobby, use an authorized external scheduler with the same bearer secret or explicitly select a supported deployment plan; do not silently fall back to a daily queue drain.

## CI Object Storage

CI pins the publicly available third-party Sourcemation MinIO build `RELEASE.2025-10-15T17-29-55Z` by multi-platform digest `sha256:e1c92c5362c5e0d9a5cf5c6fd11e5c6f72fbcc7bdfd6fad94d0a3eb12784ba9a`. The former official `minio/minio` Docker Hub repository was unavailable when checked, and Quay denied anonymous access; no nonexistent upstream tag is used. This is not an official MinIO image. The packaged binary reports `DEVELOPMENT.GOGET`, so the registry digest, not its version banner, is the artifact identity. See the [publisher's image documentation](https://hub.docker.com/r/sourcemation/minio).

Use this image only as disposable CI/local test storage, with test credentials and loopback-only port binding, never as a production storage recommendation. Recheck publisher provenance and digest deliberately when updating. Re-run `npm run audit:production` before each public deployment, plus the application's integration/build checks.

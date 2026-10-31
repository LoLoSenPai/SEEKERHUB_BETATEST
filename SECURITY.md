# Security Policy

## Reporting

Do not publish suspected vulnerabilities in a public issue. Use the monitored contact shown on `/abuse` so reports can be triaged privately.

## Dependency Gate

Reviewed on 2026-10-31 against the npm registry and official advisories. Every critical finding blocks promotion. Every high finding blocks promotion except the exact versions, install locations, dependency edges and advisory URLs below, enforced by `npm run audit:production`. Audit failures and incomplete reports fail closed. This is not a claim of zero vulnerabilities.

Updated Next.js and matching ESLint config to 16.4.3, Better Auth to 1.7.14, and React/React DOM to 19.2.9. Removed the obsolete Sharp override: Next now requires patched Sharp ^0.35.5. Relevant upstream notices: [Next image optimizer](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw), [Sharp librsvg](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), [Better Auth token confusion](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm), [React patch](https://github.com/facebook/react/releases/tag/v19.2.9).

The only cross-major override is `@prisma/config -> deepmerge-ts@8.0.2` for [recursive object exhaustion](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx). Prisma 6.19.3 imports the unchanged named `deepmerge` API exclusively for local configuration loading (remote config extension is disabled). Prisma generation, validation and local config loading must remain working. This avoids an unrelated Prisma/schema major migration. Remove the override when the supported Prisma line includes the fix.

Better Auth 1.7's custom rate-limit storage requires only atomic `consume`; the adapter keeps its HMAC keys and conditional database writes, removing obsolete `get`/`set` hooks rather than restoring a racy fallback.

### Solana Fixed-Width Layouts

- Exact entries: `bigint-buffer@1.1.5`, `@solana/buffer-layout-utils@0.3.0`, `@solana/spl-token@0.4.15`, each at its root `node_modules/` location.
- Only underlying high advisory: [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg). No upstream patched bigint-buffer release exists. Do not use the breaking SPL downgrade suggested by `audit fix --force`.
- Reviewed caller: `src/lib/solana/sgt.ts` uses `unpackMint`, `getMetadataPointerState` and `getTokenGroupMemberState`. Mint supply and group-member numbers use `u64` layouts. `@solana/buffer-layout-utils/lib/cjs/bigint.js` decodes a `blob(8)` before calling `toBigIntLE`; it never forwards the whole RPC buffer. Other exported unsigned layouts are also fixed at 8/16/24/32 bytes. Short data fails in the layout layer. No application module imports bigint-buffer or its arbitrary-length API directly.
- The affected arbitrary-length native conversion is therefore not exposed by these callers, even with attacker-controlled mint account bytes. Rate limiting and RPC batching are supplementary controls, not a memory-safety justification. Do not rely on the optional native binding failing to compile locally.
- Re-review if SGT parsing changes, a variable-width layout/native call is introduced, or any locked version/edge changes. Remove on an upstream compatible fix or a separately authorized parser migration.

### Metro-Only Image Parser

- Exact entry: root `node_modules/image-size@1.2.1`; only advisories [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr).
- Installed through the wallet stack's React Native peer tooling: `react-native -> @react-native/community-cli-plugin -> metro -> image-size`. `npm explain image-size` identifies this tooling path. Only `metro/src/Assets.js` imports it; no application file imports Metro or image-size. App scripts run Next.js, not a Metro server or React Native asset bundler. Uploaded APKs use `@devicefarmer/adbkit-apkreader`, not this parser. It is not Next's Sharp image optimizer.
- No patched 1.x exists. A forced 2.x override is incompatible: Metro calls the synchronous filename API, which [image-size 2 removed](https://github.com/image-size/image-size/releases/tag/v2.0.0). Preserving the native peer installation avoids introducing a native-platform blocker merely to silence audit.
- This exception is only valid for this Next web application. Before deployment, verify the Next server trace does not include Metro/image-size. Any native app, Metro execution, new importer or image-processing path invalidates it. Remove when the official wallet/React Native peer stack resolves a compatible fixed parser.
- Local evidence for the 2026-10-31 audit implementation: the final Next build contained 42 server `.nft.json` traces with no Metro or image-size paths. The APK worker passed from a copy of only its traced deployment files. Repeat both checks for subsequent release builds.

### Remaining Moderate Findings

The Solana web3.js/Jayson chain retains `uuid` and `stream-json` advisories. Jayson generates v4 UUIDs without caller-provided buffers; the reported uuid issue affects v3/v5/v6 buffer-writing APIs. The app's RPC client uses HTTP JSON responses, not Jayson's streaming TCP server/filter APIs; those stream-json paths are not application entry points. These are tracked, not globally suppressed or force-upgraded across incompatible APIs. Re-review when adding transports or updating the wallet stack.

## Cleanup Operations

`/api/cron/cleanup` requires `CRON_SECRET`. It runs every ten minutes, with at most four 25-row batches each for expired reservations and storage tasks. New reservation work stops after 20 seconds and deletion work after a shared 40-second budget; S3 deletion is abortable within ten seconds or the remaining budget. Database calls and final bookkeeping may extend beyond that work budget; the function ceiling is 60 seconds. Auxiliary retention deletes are bounded to 25 projects/orphan releases and 500 rows per other table per invocation. No schema migration is required.

Task claims compare the observed `updatedAt` and `attempts`. PROCESSING leases expire after 15 minutes, longer than the function lifetime; completion and failure updates are fenced to that exact claim. Failed work is rescheduled with exponential delays of 5/10/20/40 minutes, with five automatic attempts total. A crash during the final attempt becomes an exhausted FAILED task after lease expiry rather than remaining PROCESSING forever. Deletion is idempotent; quota decrement and task completion share a database transaction. Unknown/active resources are rejected before S3 deletion.

Upload cleanup shares `inspectedApkKey` and `uploadCleanupAt` with finalization. `UploadStaging` is valid for a completed session; `UploadFinal` is rejected if it is completed or referenced by a BuildAsset. The worker waits until presign expiry plus a one-hour replay/in-flight grace period and until finalization's lease is stale. All remaining reserved bytes stay charged until every staging/orphan-final deletion task is physically completed. A session-row lock serializes settlement of the two objects; legacy already-released `UploadSession` tasks cannot decrement quota a second time. Completed sessions remain available for idempotent finalize replies. Project pruning excludes sessions with unsettled reservations.

Structured `cleanup.completed` logs include counts, due/deferred/processing/exhausted backlog and oldest due age. `cleanup.manual_review_required` is an error event for exhausted tasks; operators should alert on it and on growing oldest due age. Review the existing admin purge workflow for exhausted tasks; it is not an automatic unlimited retry loop. No cleanup invocation against production is part of local validation.

The ten-minute schedule requires Vercel Pro/Enterprise: [Hobby only supports daily cron](https://vercel.com/docs/cron-jobs/usage-and-pricing). On Hobby, use an authorized external scheduler with the same bearer secret or explicitly select a supported deployment plan; do not silently fall back to a daily queue drain.

## CI Object Storage

CI pins the publicly available third-party Sourcemation MinIO build `RELEASE.2025-10-15T17-29-55Z` by multi-platform digest `sha256:e1c92c5362c5e0d9a5cf5c6fd11e5c6f72fbcc7bdfd6fad94d0a3eb12784ba9a`. The former official `minio/minio` Docker Hub repository was unavailable when checked, and Quay denied anonymous access; no nonexistent upstream tag is used. This is not an official MinIO image. The packaged binary reports `DEVELOPMENT.GOGET`, so the registry digest, not its version banner, is the artifact identity. See the [publisher's image documentation](https://hub.docker.com/r/sourcemation/minio).

Use this image only as disposable CI/local test storage, with test credentials and loopback-only port binding, never as a production storage recommendation. Recheck publisher provenance and digest deliberately when updating. Re-run `npm run audit:production` before each public deployment, plus the application's integration/build checks.

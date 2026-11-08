# Beta readiness checkpoint

## Unified homepage, account entry and brand (2026-11-08)

- The product homepage has one Get started entry and one secondary Sign in link. Signed-in visitors return to `/dashboard`. Auth no longer asks visitors to choose builder/tester; email links, wallets and existing passwords share the same account. Valid invitation `returnTo` destinations take priority; legacy `intent` links remain compatible.
- Publishing / Testing is a visible dashboard switch, remembered per account and browser through an HttpOnly cookie. It is a navigation preference, never an authorization grant. New accounts do not automatically receive a BuilderProfile; verified email and explicit activation are still mandatory. Guests remain blocked from builder pages and APIs.
- Wallet-only durable accounts can add a recovery/publishing email without recreating the account. Verification retains their user ID, wallets and tester history. Existing verified email changes require confirmation from the current address and verification of the new one. An email already owned by another established account is not silently merged.
- Shared return-path validation now rejects control-character and encoded-separator redirects, including the nested onboarding case. The existing rate-limit tests use a deterministic limiter clock across minute boundaries; application limits are unchanged.
- Final local validation including branding: **501 unit tests across 55 files; 87 integration tests across 13 files; 25/25 E2E tests in 79.3 seconds; lint, typecheck, production build and isolated APK artifact check pass**. Browser tests cover both themes at 320, 390 and 1440 px, Axe/overflow, workspace activation and persistence, forbidden guest publishing, preserved invite destinations, private media, publish/download/feedback and wallet recovery. Contrast scans wait for fonts, transitions and a neutral pointer position. The production dependency gate passes with zero critical and the four previously documented high exceptions; no dependency changed.
- Preview: `http://127.0.0.1:3102`, built in ignored `output/homepage-build-20261108` without copying environment files. PostgreSQL and MinIO remain the isolated loopback review services described below; the existing preview on port 3100 was left intact. Final evidence: ignored `output/brand-{unit,integration,build}.log`, `output/brand-e2e.json` and `output/brand-homepage.png`.
- Brand follow-up: the user selected a distinct connected-block symbol instead of the initial S concept. The generated source and prompt are preserved in `assets/brand`; `scripts/build-brand-icons.mjs` packages PNG and RGBA ICO sizes. Site metadata, homepage/workspace branding and the existing MWA/opt-in Seeker Connect identities share `/brand/seekerhub-icon.png`, resolved against the actual app origin. No wallet-registration, signature or access behavior changed.
- Production visual follow-up: preserve the artwork's square aspect ratio on mobile/tablet so the symbol is not cropped behind the captions. The mobile smoke test asserts this at 320, 390 and 768 px.
- **Production rollout from `main` explicitly approved on 2026-11-08.** No production data, credentials, environment variables or schema changes are required. Pre-rollout production health is ready; rollback baseline is commit `bf7ba1d990aa0dad87941359bf505f256fcf9881`, deployment `dpl_4puWz29E3cJZRHgHX1y7fGkifcWq`. The release receipt is kept in ignored `output/brand-production-receipt.json` after deployment verification. Recheck real email delivery and physical wallet behavior after rollout: email integration tests capture messages locally and browser wallets are controlled fixtures, not physical Seeker proof. Wallet applications may cache their displayed identity independently.

## Redesign checkpoint (2026-11-08)

- Chosen UI: light blue surfaces with black accents and a desktop sidebar. Mobile tester navigation is **My apps / Feedback / Account**; Feedback includes the tester's submitted-report history, subject to current metadata access.
- App icons, banners and screenshots use private, authorized short-lived URLs and normalized WebP, with capped inputs/outputs, an 8 MiB project cap and shared builder-quota accounting. Exact limits and lifecycle guarantees are in the [media feature README](../src/features/project-media/README.md). Additive migration: `20261108000000_project_media`.
- Explicit opt-in `SIGN_IN_AND_VERIFY_SGT` is issued only for a server-validated SGT-required invitation/release context bound into the message. One signature authorizes login and a fresh SGT ownership check. Login is retained after RPC failure without granting or refreshing SGT verification. Ordinary `SIGN_IN` is unchanged; already-linked wallets retain the explicit separate verification action. No silent signature reuse, automatic second prompt or hardware attestation is claimed. Successful checks remain valid for 24 hours; a stale cached check needs a refresh, not a replacement token.
- Local validation: **355 unit tests across 45 files; 80 integration tests across 12 files; 20/20 E2E tests; lint, typecheck, production build and isolated artifact check pass**. The final complete browser suite passed in 49.9 seconds against the production-mode local build. Screenshots preserve caret styles; media controls remain disabled until hydration; contrast scans wait for fonts and the opacity reveal. Repeated wallet/guest scenarios use a stable isolated client IP per test, without disabling or clearing application rate limits. Historical counts below are not the redesign's final validation.
- The user started the local `next start` server after the tool could not start it. Review services are PostgreSQL `127.0.0.1:5437/seekerhub_redesign_test`, MinIO `http://127.0.0.1:9007`, private bucket `seekerhub-redesign-test`, and app `http://127.0.0.1:3100` (see `scripts/with-review-env.mjs`). The server remains available for review. Visual comparison and evidence are in [design-qa.md](../design-qa.md); mobile navigation, download priority, themes, feedback history and private app media were verified locally. This is not a production rollout.
- **Production release explicitly authorized on 2026-11-08.** A full private PostgreSQL backup was restored into an isolated PostgreSQL 17 instance and the additive migration tested against the restored data. No Neon management API credential was available, so this verified backup/restore replaced a Neon branch rehearsal. Migration `20261108000000_project_media` is now applied to production Neon; counts remain 14 users, 7 projects and 12 releases.
- **Production deployment verified:** application commit `d998095bf82ebe457f09a3092fc4dfc862c5a497` on `main`, Vercel `dpl_A1VLkykh6TrZTdQVutXHmcoAeWb5`, READY with the canonical `https://seeker-hub.lololabs.xyz` alias. `/api/health` returns 200 with database/storage ready and email/cron/encryption configured. Builder sign-in and the tester entry return 200; unauthorized media upload returns 401, unknown/private media URL returns 404, and unauthenticated cron returns 401. Browser smoke found one wallet-connect entry, no horizontal overflow at 390 px and no console errors. No production account, image, APK or wallet signature was created for this smoke check.
- CI compatibility follow-up: the media E2E uses `NEXT_PUBLIC_APP_URL` when the optional `PLAYWRIGHT_BASE_URL` is absent, matching other fixture guards. Local-only host checks remain mandatory. The runner is pinned to `ubuntu-24.04`: `ubuntu-latest` moved to Ubuntu 26.04, unsupported by the locked Playwright 1.58.2 browser installer. GitHub reruns all validation on `main`; consult the current run rather than treating a queued run as passed.
- Backup and its SHA-256 record are stored locally in ignored `output/production-backup-20261108/`; this contains private data and must not be published. Production environment material remains ignored. Once media exists, an application rollback must retain media-aware cleanup or pause and review those deletion tasks; the older cleanup implementation does not support them.

## Historical wallet recovery and mobile follow-up (2026-10-31)

- Wallet continuation now creates or recovers one durable tester account. Current guest activity is merged transactionally, including duplicate claims, memberships and analytics; revocations survive the merge. Existing durable accounts are never silently merged or switched. Legacy wallet-linked guests can recover their original account.
- Wallet-gated invitations authenticate before claiming; ordinary invitations keep the guest option. Reopening a link while signed in reuses the current account. A connection alone never signs a message or grants SGT access.
- Builder audience creation/editing explicitly labels the gate as SGT ownership, not a current-phone restriction. Importing the same signing wallet into another device can pass; no client adapter name or device hint is used as hardware attestation.
- Physical-device follow-up: the user reported Seeker Connect opening the Solana Mobile website while standard MWA worked. Seeker Connect Wallet Standard 0.2.0 is the correct web SDK, but its HTTPS App Link must be intercepted by Android/the wallet. The official Asset Links endpoint returned valid JSON; the device association/browser state remains unverified. Registration now requires `NEXT_PUBLIC_ENABLE_SEEKER_CONNECT=true` (default false), HTTPS and a relay. Accepted relay terms alone do not activate it. Do not override the SDK URI or assume a native-module migration fixes this.
- Wallet connection now has a single entry point: standard MWA on Android Chrome, the Wallet Standard picker elsewhere. Removed the duplicated Seeker/other-wallet CTAs. A connected account is shown once with a secondary disconnect control; sign-in still requires an explicit signature. Once that wallet is linked to the current tester, the redundant sign-in CTA disappears and required SGT verification is the primary next action. No authorization rule changed.
- Primary `.skr` names use the official 1.1.1 SDK, server-side ownership/expiry checks, bounded caches and caller-wallet authorization. Client lookups are coalesced per account/address. Missing names or RPC failures fall back to the address without blocking authentication or downloads.
- Create, save, upload, publish and authentication controls preserve their values and stay locked through successful navigation. Failed operations allow explicit retry; upload retries reuse the saved session.
- Analytics separate email/wallet accounts from guest browser identities, deduplicate merged history and distinguish places used, unique downloaders and download links issued. Detailed definitions are collapsed by default. No device fingerprinting was introduced.
- PostgreSQL concurrency tests cover account recovery, preservation of concurrent revocations and atomic rate-limit increments. That October wallet-only change required no new schema migration, production database write, real-wallet signature or production storage write for validation; the November redesign does require the media migration above.

Validation after the mobile follow-up: ESLint/typecheck and production build pass; 252 unit tests across 29 files, 73 PostgreSQL/MinIO integration tests across 10 files, and 19 browser tests pass. The isolated APK-worker artifact gate passes. Dependency audit remains at zero critical, four documented high exceptions and fourteen moderate findings.

Browser wallet fixtures sign real authentication challenges with disposable test keys and exercise actual session cookies/backend authorization. The 390px Android journey uses a mock MWA-named Wallet Standard wallet: one connect button, no redundant picker, disconnect/reconnect without implicit signing, explicit sign-in, then SGT still blocked. This validates application routing, not native App Links, the real relay, Seed Vault prompts or physical Seeker behavior. SGT gating tests use controlled fixtures, not a live SGT wallet. A physical-device sign-in, verification, sign-out and recovery check remains required before claiming that boundary validated.

Historical pre-deployment checkpoint following the 2026-10-31 audit: changes were validated locally on `main`; no production migration, email send, R2 write or deployment was used for that validation. The user subsequently authorized that earlier production release from `main`, not the 2026-11-08 redesign.

## Historical delivered baseline

- Clear public builder/tester choices, recovery guidance and preserved return destinations.
- Upload -> checked private draft -> release notes -> audience -> review -> explicit publication and share link. Publication retries reuse the original invitation, including app-wide invitations.
- Audience presets retain combined restrictions; broadening an existing audience requires confirmation. Advanced options are disclosed progressively and link scope, limits and expiry are summarized before publication.
- Builder identity is visible; navigation is no longer a misleading global progress tracker. Projects/releases come before settings, with matching DOM and visual order.
- Tester pages prioritize app identity, download and feedback. Required wallet/SGT actions are distinguished from optional account recovery. Download uses a normal anchor, never a prefetched Next route.
- Final APKs use a server-only, create-only object key containing the exact inspected bytes. Staging replay cannot replace the distributed APK. Transport uses R2-compatible Content-MD5; SHA-256 remains the inspection identity.
- Bounded APK parsing runs in a terminable worker. The production trace explicitly includes its native dependencies, verified outside the checkout.
- Allowlist discovery, invite expiry/revocation before seat grant, physical-byte quotas and cleanup/admin purge accounting are covered by regression tests.
- Cleanup runs every ten minutes with bounded work, fenced leases, retries and backlog logs. Framework/auth dependencies and the dependency audit gate were updated.

## Historical local validation (before redesign)

All service credentials were overridden with disposable local PostgreSQL/MinIO configuration. No tests targeted the production deployment.

| Check | Result |
| --- | --- |
| ESLint and TypeScript | Pass |
| Unit tests | 139 passed across 17 files |
| PostgreSQL/MinIO integration | 35 passed across 6 files |
| Production Next build | Pass |
| Isolated deployment artifact | Native and compiled APK workers pass using only traced files |
| Playwright against `next start` | 13 passed |
| Dependency gate | 0 critical; 4 narrowly reviewed high exceptions; 14 moderate |

Browser coverage includes a synthetic APK uploaded through the UI, checked as a draft, explicitly published, claimed by a separate guest and downloaded by clicking the button. Downloaded bytes match the fixture. Other checks cover persisted feedback, clipboard sharing, release-scoped invitations, no premature publication/download events, return destinations, keyboard focus, no horizontal overflow and Axe scans in light/dark at 390px and desktop.

The synthetic fixture is not an installable, cryptographically signed Android application. Automated Axe checks do not establish full accessibility compliance. The 42 final Next server traces contain no Metro/image-size paths; dependency exceptions remain documented in `SECURITY.md`.

## Before public promotion

1. The authorized production rollout, backup/restore rehearsal, Neon migration and public smoke checks are complete. Confirm the current GitHub checks before promotion. Keep private-media cleanup enabled; future deployments must rebuild on Vercel with production public URLs, not reuse the local review `.next` artifact. Test one real app-image upload/replacement/removal and its eventual quota settlement on R2; public smoke only verified route/auth startup, not an authenticated production image transformation.
2. Check a real signed 450-500 MiB APK on R2/Vercel, with an appropriate per-APK and total quota. Finalization temporarily reserves twice the APK size until staging cleanup; default public quotas were not raised.
3. Validate MWA and a real SGT wallet on physical Android/Seeker, including an ineligible tester, a cached SGT check needing refresh, combined consent, RPC failure and recovery on a second device. Desktop mobile emulation is not device proof.
4. Check real Resend verification/magic-link delivery, sender configuration and recovery behavior. Local auth tests use seeded verified accounts, not delivered emails.
5. Review privacy/terms and the monitored abuse contact. These pages remain explicitly legal drafts, not approved legal advice.
6. Observe the deployed cleanup schedule, backlog and quota settlement; configure an operator alert for exhausted deletion tasks before increasing traffic.

Start with a small invited pilot after these checks, not a claim that every production boundary has already been validated.

## Follow-up improvements

Private app icons/banners/screenshots and tester-visible feedback history are delivered in the 2026-11-08 redesign, not V2 backlog. Optional QR sharing, builder feedback status/replies, social preview metadata, resumable large-file transfers, and full Android signature verification remain follow-up work. Unsubmitted notes/audience edits are not autosaved; the uploaded APK draft is saved and the UI states this distinction.

Historical operations note from the October checkpoint: local test services were stopped after that validation, and a temporary packaging QA clone was left at `E:\CODE\PERSO\APK_PACKAGING_QA` because tool-level deletion was blocked. This is not a current service/clone inventory. The clone is not required by the app and contains junctions to the original dependencies; do not recursively follow those junctions when cleaning it up.

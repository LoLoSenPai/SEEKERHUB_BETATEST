# Beta readiness checkpoint

Pre-deployment checkpoint following the 2026-10-31 audit. At the end of implementation, changes were validated locally on `main`; no production migration, email send, R2 write or deployment was used for that validation. The user subsequently authorized a production release from `main`.

## Delivered

- Clear public builder/tester choices, recovery guidance and preserved return destinations.
- Upload -> checked private draft -> release notes -> audience -> review -> explicit publication and share link. Publication retries reuse the original invitation, including app-wide invitations.
- Audience presets retain combined restrictions; broadening an existing audience requires confirmation. Advanced options are disclosed progressively and link scope, limits and expiry are summarized before publication.
- Builder identity is visible; navigation is no longer a misleading global progress tracker. Projects/releases come before settings, with matching DOM and visual order.
- Tester pages prioritize app identity, download and feedback. Required wallet/SGT actions are distinguished from optional account recovery. Download uses a normal anchor, never a prefetched Next route.
- Final APKs use a server-only, create-only object key containing the exact inspected bytes. Staging replay cannot replace the distributed APK. Transport uses R2-compatible Content-MD5; SHA-256 remains the inspection identity.
- Bounded APK parsing runs in a terminable worker. The production trace explicitly includes its native dependencies, verified outside the checkout.
- Allowlist discovery, invite expiry/revocation before seat grant, physical-byte quotas and cleanup/admin purge accounting are covered by regression tests.
- Cleanup runs every ten minutes with bounded work, fenced leases, retries and backlog logs. Framework/auth dependencies and the dependency audit gate were updated.

## Local validation

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

1. Review and approve the local changes, then deploy from `main` with the existing production environment. This change set does not require a Prisma schema migration. Let Vercel build with production public URLs; do not reuse the local review `.next` artifact.
2. Check a real signed 450-500 MiB APK on R2/Vercel, with an appropriate per-APK and total quota. Finalization temporarily reserves twice the APK size until staging cleanup; default public quotas were not raised.
3. Validate MWA and a real SGT wallet on physical Android/Seeker, including an ineligible tester, expired verification and recovery on a second device. Desktop mobile emulation is not device proof.
4. Check real Resend verification/magic-link delivery, sender configuration and recovery behavior. Local auth tests use seeded verified accounts, not delivered emails.
5. Review privacy/terms and the monitored abuse contact. These pages remain explicitly legal drafts, not approved legal advice.
6. Observe the deployed cleanup schedule, backlog and quota settlement; configure an operator alert for exhausted deletion tasks before increasing traffic.

Start with a small invited pilot after these checks, not a claim that every production boundary has already been validated.

## Follow-up improvements

Optional QR sharing, tester-visible feedback history, builder feedback status/replies, richer app branding/social previews, resumable large-file transfers, and full Android signature verification remain follow-up work. Unsubmitted notes/audience edits are not autosaved; the uploaded APK draft is saved and the UI states this distinction.

Local test services were stopped after validation. A temporary packaging QA clone remains at `E:\CODE\PERSO\APK_PACKAGING_QA` because tool-level deletion was blocked; it is not required by the app and contains junctions to the original dependencies. Do not recursively follow those junctions when cleaning it up.

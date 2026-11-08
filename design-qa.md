# Redesign QA - 2026-11-08

## Evidence and scope

- Source visual truth: `C:/Users/loicd/.codex/generated_images/019d35df-5f08-7350-b934-2c34485a3b2d/exec-aa8174ff-c300-4854-874d-3e9b21a26f92.png`.
- Implementation: `http://127.0.0.1:3100`, production-mode Next build, isolated PostgreSQL/MinIO only.
- Desktop capture: `output/design-qa/builder-media-desktop.png` (1440 x 900 CSS/pixels, DPR 1).
- Mobile capture: `output/design-qa/tester-media-mobile.png` (390 x 844 CSS/pixels, DPR 1).
- Additional states: `output/design-qa/builder-fallback-desktop.png`, `output/design-qa/tester-dark-mobile.png` (full-page).
- Source is a 1717 x 916 concept board containing desktop and mobile panels, not a single browser viewport. Its panel dimensions and fictional content differ from the runtime. The comparison is directional, not a pixel-diff claim. All captures are content-only, without browser chrome or device frames.
- Source and both implementation captures were opened together in one comparison input after the fixes below. Typography, controls and spacing were readable at that resolution; an extra crop was not needed to resolve a remaining ambiguity.

## Comparison

- **Typography:** retained Manrope and the existing monospaced labels. The app name, primary action and section headings have distinct weights and sizes. The concept's fictional publisher name is not fabricated in the app; long account identifiers truncate inside the sidebar and remain available in the account menu.
- **Layout:** black fixed desktop sidebar, blue app header, contextual next action, release list and right-hand app presentation follow the selected direction. Desktop spacing adapts to 1440 px rather than stretching the narrower concept panel. At 390 px the sidebar becomes a small header and bottom navigation. Download stays above the fold, including with a banner. Technical details and feedback are collapsed initially.
- **Color:** near-black primary actions/sidebar, icy light surfaces, blue atmosphere and restrained warm feedback accents match the chosen direction. Dark mode preserves legibility. Axe reports no violations in the passing media scenario and builder/tester scenarios, including light/dark checks. Contrast measurements wait for the opacity reveal to finish rather than disabling a contrast rule.
- **Images:** the decorative atmosphere is a generated image asset, not a CSS/SVG imitation. Actual uploaded images are normalized WebP and served through private authorized URLs. Banner width/crop is correct. Screenshots use `object-contain` so product content is not cropped. The automation uploads the atmosphere as clearly synthetic test media to exercise all three types; it is not presented as a real Orbit Notes screenshot. No fictional app logo, publisher/avatar or mock screenshots are inserted into production data. Empty media uses an explicit app fallback and guidance.
- **Copy and controls:** My apps / Feedback / Account provides a permanent way back for testers. The builder has Builds / Invite links / Testers / Feedback / App profile, a real upload/invite next step and a usable account menu. Operational Trash and workspace switching intentionally replace the concept's generic Settings item. No fake unread badge or unimplemented preview control was added.

## Comparison history and fixes

1. **P2: duplicated mobile page introduction and landmark coverage.** Compact tester/project headers now let app identity lead, and the main landmark includes the page heading. Post-fix evidence: mobile capture and passing Axe scenarios.
2. **P2: sticky publication actions overlapped mobile navigation/focused fields.** The CTA is offset above the bottom navigation and form scroll margins reserve its height. Post-fix evidence: 390 px publication journey verifies focused fields remain visible and clear of the footer.
3. **P2: banner could collapse to a partial width with fixed height.** Added an explicit full-width banner container. Post-fix evidence: both final media captures show full-width banners in their allocated columns.
4. **P2: pre-hydration media interaction could be lost.** Upload controls remain disabled until hydration and busy during requests. SSR/hydration regression tests and the real three-image UI upload now pass.
5. An initial screenshot showed a loading skeleton, not the target state; it was rejected as comparison evidence. Captures now wait for the app heading, fonts and reveal animation. Playwright keeps caret styles unchanged to avoid modifying server markup before hydration.

## Validation and remaining boundary

- Passing browser scenarios cover actual synthetic APK upload/publication/download byte equality, invitation claiming, feedback persistence, account navigation, private image upload/access denial, storage accounting, keyboard focus, mobile overflow and light/dark accessibility scans.
- Manual browser review checked the app page, mobile download position, account menu, theme switching, feedback disclosure and persistent Feedback navigation. The inspected mobile tab had no console errors.
- Final complete E2E run: **20/20 pass in 49.9 seconds**. Repeated wallet and guest runs initially shared the loopback IP and reached the real claim rate limit (HTTP 429). Each scenario now has a stable isolated client IP; claim responses are asserted explicitly. No application protection was disabled and no rate-limit counters are cleared. The wallet scenarios also passed twice consecutively in isolation.
- Typecheck and targeted test lint pass. The prior complete checks passed 355 unit tests, 80 integration tests, lint, production build and the isolated deployment-artifact gate.
- Real Seed Vault/MWA prompts, live SGT verification, delivered email, production R2 and deployment are not validated by local browser emulation. After this QA pass, the user authorized rollout and the media migration was applied to Neon following a verified private backup/restore rehearsal; deployment status is tracked separately in `docs/beta-readiness.md`.

## Remaining checklist

- Completed: resolve test isolation, rerun wallet scenarios and the complete browser suite; lint, typecheck and whitespace checks pass.
- Completed: explicit approval and production media migration. Verify the authorized Vercel rollout from main separately from this local design QA.
- Run the physical-device and production smoke checks documented in `docs/beta-readiness.md`.

No actionable P0/P1/P2 visual or local functional findings remain in the reviewed scope. Physical-device, production-service and deployment boundaries above remain explicit follow-up gates, not implied passes.

final result: passed

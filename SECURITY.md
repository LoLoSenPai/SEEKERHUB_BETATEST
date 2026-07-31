# Security Policy

## Reporting

Do not publish suspected vulnerabilities in a public issue. Use the monitored contact shown on `/abuse` so reports can be triaged privately.

## Dependency Audit Exceptions

The public beta must ship with zero known critical vulnerabilities. High-severity findings are blocked unless they are documented here with their reachable surface and mitigation.

### Solana `bigint-buffer`

- Upstream advisory: `GHSA-3gc7-fjrx-p6mg`
- Source: `@solana/spl-token` through `@solana/buffer-layout-utils`
- Status: no patched upstream release is currently available; `npm audit fix --force` proposes a breaking downgrade and must not be used.
- Reachable surface: server-side parsing of Token-2022 mint accounts during SGT verification.
- Mitigations: SGT verification is rate limited, RPC results are processed in batches of 100, malformed mints are isolated and rejected, and the code never exposes `bigint-buffer` directly to request input.
- Removal plan: migrate the SGT parser when the official Solana Mobile verification stack provides a patched dependency path.

Re-run `npm audit --omit=dev` before each public deployment. Any new critical finding, or high finding not listed above, blocks promotion.

The moderate `uuid` advisory inherited through Solana Wallet Adapter does not affect SeekerHub's UUID generation because the application uses `crypto.randomUUID()` and never calls the vulnerable buffer-writing API. It remains tracked until the official wallet stack upgrades its dependency.

`npm run audit:production` enforces this exception list in CI. It fails on every critical finding and on any high-severity package outside the three entries currently forming the `bigint-buffer` dependency chain.

# Evotor release-gate fixes — 2026-10-06

This follow-up resolves the dependency and test-runner blockers recorded in
EVOTOR-CI-EVIDENCE.md. It does not resolve actual terminal/cloud receipt proof.

## Changes

| Package | Before | After |
|---|---|---|
| compression (both root packages) | 1.8.1 | 1.8.2 |
| express | 4.22.2 | 4.22.3 |
| body-parser | 1.20.6 | 1.20.8 |
| proxy-addr | 2.0.7 | 2.0.8 |
| qs | 6.15.1 | 6.16.0 |
| source-map-js (root and Business) | 1.2.1 | 1.2.2 |
| Business @playwright/test / playwright / playwright-core | 1.55.0 | 1.55.1 |
| Business Vitest family | 3.2.7 | 4.1.11 |
| Business brace-expansion | 1.1.18 / 5.0.9 | 1.1.21 / 5.0.12 |

Vitest 4 removes the vulnerable tinypool dependency and fixes the mocker advisory.
Its compatible support dependencies changed with it. Playwright remains pinned
exactly; Express stays on major 4. No force audit fix, audit exceptions or lower
thresholds. Root lockfile metadata now matches the existing package version.

Business npm test targets all existing Node test files under test/ with a quoted
Node 24 glob. The inherited release workflow also installs admin-platform's exact
lockfile, runs all its Vitest tests separately, and audits its full dependency
set. Existing tests are neither deleted nor skipped to make the gate pass.
The isolated Playwright fixture server now explicitly binds to 127.0.0.1.

## Local evidence

- Exact npm ci installs succeed for both root packages and admin-platform.
- Full npm audit: zero findings in all three packages; root runtime audit also zero.
- Root: 461/461 Node tests; syntax check and existing VK startup parity pass.
- Business root: 136/136 Node tests after materialization; syntax check passes.
- Business Vitest 4.1.11: 61 pass, 14 pre-existing live-PostgreSQL tests skipped.
- Business TypeScript/API/Vite build passes; lint has zero errors, 10 existing warnings.
- Real Chromium dashboard fixture: desktop/mobile 2/2 pass with Playwright 1.55.1.
- Materialize twice is byte-idempotent on both branches. Generated runtime output
  was restored after verification; this follow-up changes dependencies, test setup
  and documentation only.
- Root npm pack --dry-run and backup/restore shell syntax pass.

Cloud CI results apply only after the new source commits are checked. Consult the
PR checks for those exact commits rather than reusing older green step results.

## Remaining before full production integration

Actual anonymized closed SELL/PAYBACK cloud JSON is still required to establish
Extras namespace, receipt UUIDs, return ancestry and fiscal semantics. Extras are
still ignored; app-client cohort uses confirmed scoped administrative links.
Real terminal/Keystore and concurrent PostgreSQL behaviour remain unverified.
Business is still stacked on the unmerged #176 pilot, not ready for an automatic
whole-pilot merge into main. Feature remains off by default; migrations remain
manual. No main merge, production deployment, DB change or APK installation was
performed by this follow-up.

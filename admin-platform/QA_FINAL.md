# FINAL QA — frozen Admin Platform snapshot

Date: 2026-08-29

## Status

- Visual QA: PASS in local Chromium QA runtime.
- Browser QA: PASS in local Chromium QA runtime.
- Production pilot: NOT READY because normal npm dependencies and PostgreSQL integration environment were not available in this sandbox.
- Production VK/TG changed: NO.
- Production deploy: NO.
- Production migrations: NO.

## Final available checks

```text
syntax: PASS — 50 TypeScript/TSX files, 0 syntax errors
frontend offline strict typecheck: PASS
server offline strict typecheck: PASS
server-tests offline strict typecheck: PASS
security logic: PASS — 8/8
isolation check: PASS

customer runtime imports: 0
destructive legacy migrations: 0
Demo Mode production API writes: 0
Admin service customer API namespace: 0
```

Security logic cases:

```text
PASS scrypt authentication primitives
PASS tenant URL/body-independent authorization query
PASS bonus amount/user/idempotency validation
PASS decimal-safe wheel probability = exactly 100%
PASS loyalty threshold invariants
PASS server-side promotion state
PASS Demo Mode cannot perform production API writes
PASS additive-only migration policy
```

## Browser QA

Final local Chromium run:

```text
Browser QA: PASS
Screenshots: 15
Console errors: 0
Unhandled/page errors: 0
Unexpected failed requests: 0
```

Covered:

- SUPER ADMIN login
- Platform overview
- Companies
- Venues
- company/venue switch
- Venue Dashboard
- period selectors
- Analytics
- VENUE ADMIN login
- tenant-scoped CRM
- client search
- client drawer/profile
- Loyalty
- Wheel
- Shop
- Achievements
- Promotions
- Branding
- Settings
- Audit
- Demo Mode
- mobile navigation
- 1920×1080
- 1440×900
- 1366×768
- 1024×768
- 768×1024 tablet
- 390×844 mobile

Control QA:

```text
PASS Loyalty add/toggle/remove
PASS Wheel add/toggle/remove
PASS Achievements editor open/cancel
PASS Shop editor open/cancel
PASS Promotions editor open/cancel
PASS Branding edit/save
PASS Settings toggle/save
PASS Logout

Console errors: 0
Page errors: 0
Failed requests: 0
```

## Normal npm toolchain result in this sandbox

`npm install` was attempted again before packaging and timed out because the sandbox cannot resolve/reach the npm registry.

Consequences:

- normal `npm run build`: BLOCKED because React/Node type packages are not installed;
- normal `npm run typecheck`: BLOCKED for the same dependency reason;
- `npm run lint`: BLOCKED because ESLint is not installed;
- `npm test`: BLOCKED because Vitest is not installed;
- `npm run test:security`: BLOCKED because Vitest is not installed;
- `npm run test:integration`: BLOCKED because Vitest/PostgreSQL are unavailable;
- Node `npm run test:e2e`: BLOCKED because `@playwright/test` is not installed.

The browser QA above used the installed Python Playwright + system Chromium and the included self-contained synthetic QA runtime generated from current TSX/CSS.

## Data status

REAL:
- Admin server/auth/tenant/config/write-path source code and production-schema adapters are the real implementation.
- No live production DB was connected for this frozen visual QA run.

DEMO:
- Sales Demo Mode is synthetic and explicitly marked.
- Local QA screenshots use synthetic staging data and are explicitly marked.

PARTIAL:
- Production-mode visual screens in the screenshots were exercised against the synthetic local QA API contract, not live production data.
- PostgreSQL concurrency/transaction integration tests exist but were not executable in this sandbox.

## Required final screenshots

See `artifacts/screenshots/`.

The screenshot data is synthetic QA data and must never be presented as production PIVNIK metrics.

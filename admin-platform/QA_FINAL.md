# FINAL QA — Admin Platform staging release candidate

Date: 2026-08-31

## Status

**READY FOR CONTROLLED PRODUCTION PILOT**

This status means the isolated staging release candidate passed the standard build, security, real PostgreSQL integration and real-browser acceptance gates. It does **not** authorize or perform production writes, production migrations, a merge to `main`, or a production customer-config switch.

## Git / isolation

- Canonical branch: `admin-platform/staging-qa`
- Repository: `GrafTrahula666/pivnik-bonus-app`
- `main` was not merged or modified by this staging QA continuation.
- Customer VK/TG production runtime was not changed by this staging QA continuation.
- Admin Platform remains a separate service and is not a runtime dependency of the customer apps.

## Railway staging

Project: `pivnik-admin-staging`

Services:

- `admin-platform-staging` — real Admin frontend/API staging service
- `admin-postgres` — isolated PostgreSQL staging database
- `admin-platform-staging-2` — Playwright runner, returned to sleep/manual-only mode after QA

Public staging URL:

`https://admin-platform-staging-production.up.railway.app`

## Standard toolchain

Final Railway build pipeline: **PASS**

```text
typecheck: PASS
lint: PASS — 0 errors, 10 existing react-refresh development warnings
unit: PASS — 45 passed; 14 PostgreSQL tests intentionally skipped in the build-stage unit run
security: PASS — 31/31
build: PASS — real TypeScript + Vite production build, 2277 modules transformed
```

Non-blocking build note: Vite reports the existing JavaScript chunk-size warning (~737 kB before gzip / ~214 kB gzip).

## PostgreSQL staging deploy

Final real isolated PostgreSQL staging deploy: **PASS**

```text
STAGING_PREFLIGHT: PASS
Admin migrations: PASS
Repeat migration / idempotency: PASS
Synthetic tenant seed: PASS
Schema verification: PASS
PostgreSQL integration: PASS — 14/14
STAGING_DEPLOY: PASS
```

Verified staging seed state:

```text
migrations: 3
admins: 3
synthetic customers: 16
wheel prizes: 6
shop items: 4
```

Tenants exercised:

- `ПИВНИК TEST` / `ПИВНИК TEST VENUE`
- `NORTH HOSPITALITY` / `NORTH BAR`

No real PIVNIK customer records were used by these tests.

## Browser / E2E — final accepted proof

Real Playwright Chromium was run against the public Railway staging URL using the real React/Vite/Recharts frontend, Admin API and staging PostgreSQL stack.

The final acceptance command is deliberately split into 9 core scenarios plus 2 small-viewport scenarios. The shell prints the final success marker only if both Playwright commands return exit code 0.

Final evidence:

```text
core Phase C: 9 passed
small responsive: 2 passed
PHASE_C_FINAL_PROOF_PASS_11_OF_11
```

Covered:

- SUPER ADMIN platform, companies, venues and full venue management flow
- Venue Dashboard and Analytics
- CRM and Customer Profile
- Loyalty
- Wheel, including exact 100% probability display
- Achievements
- Shop
- Promotions
- Branding
- Settings
- Audit Log
- real synthetic staging bonus write → Admin API → PostgreSQL → refreshed UI → Audit Log
- PIVNIK VENUE ADMIN cannot cross into NORTH tenant
- NORTH VENUE ADMIN cannot cross into PIVNIK tenant
- URL/query/body/entity substitution attempts
- Demo Mode with zero Admin API mutation requests
- responsive 1920×1080, 1440×900, 1366×768, 1024×768, 768×1024 and 390×844

The normal-flow browser harness fails on console errors, unhandled page errors, failed requests, unexpected HTTP >=400 responses, React/Recharts warnings and horizontal document overflow above 1 px.

### Harness defects found and corrected during final proof

Two failures during proof iteration were test-harness defects, not application failures:

1. After a successful synthetic bonus write, the old test tried to click `Журнал` while the Customer drawer scrim was still open. HTTP evidence confirmed `POST /bonus-adjustments` returned 200 and the refreshed customer requests succeeded. Final proof explicitly closes the drawer before navigating to Audit.
2. The old responsive helper treated the off-canvas sidebar button as `visible` at <=860 px and therefore did not open the hamburger menu. The corrected small-viewport proof explicitly opens `.mobile-menu` and waits for `.sidebar.open` before navigation. The old repeated-login pattern also unnecessarily exercised the legitimate login rate limiter; final proof authenticates once and reuses protected Playwright storage state.

## Responsive regression

The Work-session blocker was reproduced exactly at 1366×768:

```text
before: viewport 1366, document scroll width 1376, overflow +10 px
cause: topbar .profile-menu / .profile-button intrinsic flex width
```

The fix allows only the profile control/text wrapper to shrink while preserving the existing ellipsis behavior. It does not hide document overflow globally.

Final real-browser results include:

```text
1366×768: overflow 0 px
tablet 768×1024: client 768, scroll 768, overflow 0 px
mobile 390×844: client 390, scroll 390, overflow 0 px
```

All responsive acceptance cases assert `document.scrollWidth - document.clientWidth <= 1`.

## Visual evidence

The existing staging screenshot set under `artifacts/screenshots/` covers the principal sales and management surfaces, including Super Admin Platform, Companies, Venues, Venue Dashboard, Analytics, CRM, Customer Profile, Loyalty, Wheel, Shop, Achievements, Promotions, Branding, Demo Mode and mobile/tablet views.

Full-page screenshot capture is kept separate from the final small-viewport acceptance assertion because Playwright full-page capture itself timed out on the long tablet/mobile dashboard document while the underlying page, API and overflow checks remained healthy. This capture behavior is not used as a runtime acceptance criterion.

## Production safety

During this staging continuation:

```text
production VK changed: NO
production TG changed: NO
production PostgreSQL writes: NO
production Admin migrations: NO
production config switch: NO
merge to main: NO
production Admin pilot: NOT STARTED
```

The next permitted step is a **separately approved controlled production pilot**, beginning read-only. Any real production write remains a separate gate.

## Remaining non-blocking items

- 10 ESLint `react-refresh/only-export-components` development warnings; 0 lint errors.
- Vite chunk-size warning; build succeeds.
- Playwright runner infrastructure is retained in sleep/manual-only mode for repeatable staging regression testing and does not run continuously.

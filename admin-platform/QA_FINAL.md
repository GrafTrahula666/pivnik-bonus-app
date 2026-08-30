# FINAL QA — Admin Platform staging release candidate

Date: 2026-08-31

## Status

**READY FOR CONTROLLED PRODUCTION PILOT**

This status means the isolated staging release candidate passed the required standard build, PostgreSQL integration and real-browser acceptance checks. It does **not** authorize or perform production writes, production migrations, a merge to `main`, or a production customer-config switch.

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
- `admin-platform-staging-2` — temporary Playwright runner; returned to sleep/manual-only mode after QA

Public staging URL:

`https://admin-platform-staging-production.up.railway.app`

## Standard toolchain

Final Railway build pipeline: **PASS**

```text
typecheck: PASS
lint: PASS
unit: PASS — 45 passed, 14 PostgreSQL tests intentionally skipped in the build-stage unit run
security: PASS — 31/31
build: PASS — real TypeScript + Vite production build
```

The PostgreSQL integration suite is executed separately during staging deploy against the real isolated staging PostgreSQL database.

## PostgreSQL staging deploy

Final staging deploy: **PASS**

```text
STAGING_PREFLIGHT: PASS
Admin migrations: PASS
Repeat migration / idempotency: PASS
Synthetic tenant seed: PASS
Schema verification: PASS
PostgreSQL integration: PASS — 14/14
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

No real PIVNIK customer records were required for these tests.

## Browser / E2E

Real Playwright Chromium was run against the public Railway staging URL using the real React/Vite/Recharts frontend, Admin API and staging PostgreSQL stack.

Final full Phase C suite: **PASS — 11 scenarios, process exit SUCCESS**.

Covered:

- SUPER ADMIN login and platform flow
- Companies and Venues
- Venue Dashboard and Analytics
- CRM and Customer Profile
- Loyalty
- Wheel
- Achievements
- Shop
- Promotions
- Branding
- Settings
- Audit Log
- real synthetic staging bonus write → API → PostgreSQL → refreshed UI → Audit Log
- VENUE ADMIN PIVNIK → NORTH tenant isolation
- NORTH VENUE ADMIN → PIVNIK tenant isolation
- URL/query/body/entity substitution attempts
- Demo Mode with zero Admin API mutation requests
- responsive desktop/tablet/mobile checks

The browser harness fails on:

- console errors
- unhandled page errors
- failed requests
- unexpected HTTP >= 400 responses in normal flows
- React/Recharts warnings
- horizontal document overflow above 1 px

Final accepted run exited successfully.

## Responsive regression

A real-browser diagnostic reproduced the only remaining Work-session defect at 1366×768:

```text
before: document scroll width 1376, viewport 1366, overflow +10 px
cause: topbar .profile-menu / .profile-button intrinsic flex width
```

The fix allows only the profile control/text wrapper to shrink while preserving the existing ellipsis behavior. It does not hide overflow globally.

Post-fix real-browser result:

```text
viewport: 1366 px
document scroll width: 1366 px
overflow: 0 px
targeted diagnostic: PASS
```

Full responsive suite covers:

- 1920×1080
- 1440×900
- 1366×768
- 1024×768
- 768×1024 tablet
- 390×844 mobile

Each case asserts `document.scrollWidth - clientWidth <= 1`.

## Visual evidence

The existing real staging screenshot set under `artifacts/screenshots/` covers the required primary surfaces, including:

- Super Admin Platform Dashboard
- Companies
- Venues
- Venue Dashboard
- Analytics
- CRM
- Customer Profile
- Loyalty
- Wheel
- Shop
- Achievements
- Promotions
- Branding
- Demo Mode
- Mobile Dashboard

The final responsive browser suite additionally exercised all required viewport sizes after the 1366 overflow fix.

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

- Vite reports the existing large JavaScript chunk warning; build succeeds. This is a performance/code-splitting improvement, not a pilot blocker.
- Temporary Playwright runner infrastructure is retained in manual/sleep mode for repeatable staging regression testing and does not run continuously.

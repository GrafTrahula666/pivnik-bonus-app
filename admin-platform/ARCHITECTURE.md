# Architecture report — Phase A

## What exists

`admin-platform/` is a standalone Vite + React + TypeScript application using an in-memory demo data layer.

Primary modules:
- `src/domain.ts` — tenant authorization and editor validation primitives
- `src/demoData.ts` — fictional multi-company / multi-venue seed data
- `src/layout.tsx` — SaaS shell, role switcher, tenant / venue selector
- `src/pages/*` — product screens
- `src/tests/*` — tenant security and critical editor tests
- `preview/*` — dependency-free visual preview harness

## Tenant model

MVP roles:
- `SUPER_ADMIN`
- `VENUE_ADMIN`

Phase A policy primitives:
- `canAccessVenue`
- `scopedCustomers`
- `assertTenantMutation`

The browser demo uses these helpers to mirror the intended server policy.

Important: Phase B must enforce equivalent checks inside the Admin API and database queries. Browser filtering is never sufficient for production tenant isolation.

## Production repository status

The existing VK/TG repository was not supplied in the workspace.

Therefore these required repository-inspection steps are still pending:
1. identify VK Mini App production entrypoints;
2. identify Telegram Mini App production entrypoints;
3. identify backend/API entrypoints;
4. inspect current migrations and database schema;
5. locate current `bars`, `bar_customers`, `user_identities` usage;
6. locate hardcoded `BAR_CODE`, `BAR_NAME`, address, `STATUS_LEVELS`, owner/profile and achievement special cases;
7. produce the explicit Phase A "do not modify" production path list.

No production file was changed because no production repository was present.

## Phase B boundary

Recommended separate Admin service:

- `/auth/*`
- `/api/admin/me`
- `/api/admin/companies`
- `/api/admin/venues`
- `/api/admin/venues/:id/*`

Every request must:
1. resolve an authenticated admin server-side;
2. derive authorized tenant scope from that session;
3. reject foreign company/venue access;
4. scope every tenant-owned query;
5. create a tenant-correct audit entry for sensitive changes.

Suggested additive entities:
- companies
- venues
- admin_accounts
- admin_company_access
- venue_settings
- loyalty_levels
- wheel_configs
- wheel_prizes
- achievements
- shop_items
- promotions
- audit_log
- analytics_events / aggregates

No destructive migration is recommended.

## Safe Phase C integration

1. map existing `bars` records to venues without changing legacy identifiers;
2. map `bar_customers` to venue-customer relationships;
3. preserve VK/TG identity links;
4. introduce read-only analytics adapters first;
5. migrate one hardcoded venue setting at a time;
6. resolve migrated settings as:
   - valid DB value first;
   - otherwise current legacy constant/default;
7. keep legacy production endpoints alive until compatibility and rollback testing pass.

This fallback rule protects current VK/TG behavior if the admin service is unavailable or its configuration is invalid.

## Demo metric definitions

- DAU / WAU / MAU: unique customers with qualifying activity in 1 / 7 / 30 day windows.
- tracked revenue: receipts attributable to registered customers.
- average check: tracked revenue / qualifying receipt count.
- bonus liability: outstanding customer bonus balance.
- redemption rate: redeemed bonus units / earned bonus units for the selected window.
- retention 7/30/90: cohort customers returning within the defined window.

Phase A values are fictional sample analytics. Production must return `Нет данных` when a required source event is unavailable instead of fabricating BI.

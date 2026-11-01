# CHAT 10 · Loyalty boundary · пункт 91/100

> 2026-11-01. **IN PROGRESS / DOCUMENTED, NOT IMPLEMENTED.** This file is the checkpoint for the dedicated CHAT_10.md queue. Do **not** advance to 92 until 91 has code-level acceptance, negative tests and a verified integration review.

## Preflight and ownership

- Repository: `GrafTrahula666/pivnik-bonus-app`.
- Read-only baseline: `origin/main` at `c92ed7cd65f1a96d94363c2b7e212424ab078a73` (cross-checked with current GitHub file search / open PR #329 base SHA).
- Independent working branch: `spaceverse/chat10-loyalty-boundary-91-20261101`.
- No existing `chat10` branch found; relevant branches searched for `loyal`, `bonus`, and `spaceverse`. Recent unrelated Draft PRs include #325–#329; these are not to be modified.
- `ops/MODULE-MAP.md` on main: blob SHA `a3e91e8d74fc4f530234e997726d69e70bfbfc98`; reviewed relevant customer/tenant wallet sections around lines 665–724, the current “Do not break” contract around lines 1282–1312, and POS/beer/loyalty around 1510–1560.
- Main SHA combined status exposed three successful Railway contexts; this does **not** establish a complete current release-gate run or live application E2E. Commit-workflow query returned no PR-triggered workflow runs.
- This session has GitHub API access but no repository checkout: local `git` in the execution container has no `.git`, and the public GitHub host is not resolvable for cloning. No complete npm regression has been run.

## Existing boundary on main: verified from source, not inferred

1. **Legacy PIVNIK**: `loyalty-config.js` owns the seven Russian-named status levels, percentage ladder and default welcome bonus **100**. Its `configureLoyalty` process-global state and `normalizeLoyaltySettings` are used by legacy `server.js` through a single unscoped `business_runtime_config` entry `loyalty` (`business-runtime-config.js`). This is **not** a tenant-wide configuration storage contract.
2. **General Admin per venue**: `admin-platform/admin-migrations/002_configuration_foundation.sql` already defines `venue_settings(venue_id)` and `loyalty_levels(venue_id,...)`. `admin-platform/server/writes.ts` has `validateLoyalty`, `getManagedLoyalty` and `saveLoyalty` by authorized `VenueScope`. No new parallel loyalty schema is justified for #91.
3. **Legacy exception**: `getManagedLoyalty` only uses hard-coded `PIVNIK_LEGACY_STATUS_LEVELS` when `scope.companyCode === 'pivnik'`. A separate prepared, **not imported by VK/TG runtime**, `admin-platform/customer-compat/venue-config-resolver.cjs` resolves explicitly identified PIVNIK company/bar and otherwise retains the passed legacy fallback. It is not a general tenant policy reader.
4. **Unconfigured tenant**: for a non-PIVNIK venue with missing rows, `getManagedLoyalty` returns `source:'unconfigured'`, empty levels, and numerical zeroes. The `source` correctly marks unavailable configuration but zeroes should not be interpreted by UI/API consumers as an expressly configured 0%/0 bonuses. Explicit zero in a persisted row and missing configuration are **different** states.
5. **Onboarding**: `admin-platform/server/venue-onboarding.ts` currently holds `loyaltyEnabled` as a draft application boolean. A preference flag is not a provisioned wallet, activated financial program, or authorization to use the legacy PIVNIK `loyalty` key.
6. **Runtime**: `spaceverse-tenant-service.js` is a separately gated tenant API. `ops/MODULE-MAP.md` explicitly describes the tenant wallet read boundary and runtime as not fully provisioned. Do not mount payment/bonus mutations just to “finish” #91.

## Risk and acceptance criteria for one isolated implementation step

- **P1 design/data-integrity boundary**: prevent unknown tenant policy being represented as an enabled PIVNIK policy or an explicitly configured zero. Keep `Unknown ≠ true` and `missing ≠ zero` at the API boundary.
- Preserve the PIVNIK legacy defaults, saved settings, global runtime appliers and present VK/TG/QR/POS behavior unchanged.
- Reuse existing tenant-aware Admin tables and authorized `VenueScope`; do not reuse `business_runtime_config` or any process-global `configureLoyalty` for unrelated tenants.
- Make absent tenant configuration an explicit `not_configured` contract with no fabricated cashback/registration/level settings. For a fully configured tenant with an **explicit zero**, keep 0 as a real value. Do not equate the onboarding `loyaltyEnabled` draft flag to activation.
- Add narrowly targeted regression tests for: a new tenant with no settings; explicit configured zeros; PIVNIK legacy fallback unchanged; two venues with independent configurations; foreign venue access denied by the existing server authorization scope.
- Preserve `server.js`/`universal-server.js` parity if any duplicated endpoint is modified. No financial transaction/bonus writer, `pos/bonus.js`, migrations, patch-chain retirement, secret, or production changes as part of #91.
- Only after passing targeted tests **and** full `npm run materialize` twice (byte-identical), `node --test`, `npm run check`, `npm audit` should #91 be considered implementation-complete. Run Admin Platform's applicable tests/build separately if the Admin code changes.

## Current work and blockers

- **Personally completed in this session**: source/branch/PR preflight, current contract mapping, explicit risk/acceptance checkpoint in a self-contained docs-only branch.
- **Not done**: implementation, negative tests, full regression, Railway production E2E, live tenant onboarding, financial writes, merge or deployment. This is an audit-only **Draft PR**, not a release candidate.
- The Chat 10 hourly automation could **not** be created: there are already five active scheduled tasks and the current plan limit is five. No existing task was disabled or repurposed.
- **Next safe step**: pick the smallest existing Admin `getManagedLoyalty` / frontend API-consumer boundary to preserve `not_configured` versus explicit 0, then add negative tests without touching PIVNIK behavior. Continue #91, **not** #92.
- Handoff target: coordinator CHAT 01; do not merge/deploy this branch independently.

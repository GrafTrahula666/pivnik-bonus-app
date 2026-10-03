# Admin HTTP dependency security — 2026-10-03

Base: freshly fetched `origin/main`, `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`.
New branch started at that exact SHA, clean checkout. Applicable AGENTS.md
not found in repository or ancestor directories. Read current MODULE-MAP.md,
the available starter-pack copy and SPACEVERSE SaaS Admin Knowledge Base.
Prior scratch worktrees have missing git metadata; their files were not changed.

## Current implementation inventory

| Function | Found implementation | Verification in this run | Concrete gap | Next small step |
| --- | --- | --- | --- | --- |
| Cash / Evotor | `feat/evotor-sales-dashboards-20261002`, draft PR #174 | Current PR metadata, source diff and 3 successful CI runs retrieved | Real SELL/PAYBACK acceptance and activation not verified | Review existing importer; test one authorized sandbox receipt |
| Cash Business dashboard | `feat/evotor-business-cash-panel-20261002`, draft PR #176 | Source diff inspected; current release gate fails | Venue-scoped server adapter absent; Business Vitest files captured by root Node runner | Isolate runner issue, then add adapter in a separate approved step |
| CRM directory | Main `admin-user-directory.js`; `feature/admin-crm-pagination-20260919` | Main directory/race/wiring tests in full suite | Owner browser search workflow not exercised | Verify search, pagination and recovery in an authenticated test session |
| Customer 360 | `feature/admin-customer360-rebase-20260922`; Business `admin-platform/production-pilot` | Branches and Business client routes found; no end-to-end acceptance | Separate legacy and Business implementations; completeness unknown | Trace one customer's read-only history before adding features |
| Telegram broadcast | Main `broadcast-campaign-store.js`, server preview/send; retry origin branches | Fingerprint, duplicate and audit tests pass | No actual provider test or authenticated preview in this run | Verify test-message and transient retry workflow without bulk send |
| Bonus corrections | Main `admin-adjustment-persistence.js`, `server.js` adjust route; Business bonus-pilot writer | Main persistence/wiring and authorization tests pass | Legacy scoped writes deliberately disabled; Business tenant tests not run here | Review a single mutation contract and cross-tenant denial separately |
| Achievements / frames | Main achievements and personal orbital frame release; Business grant/entitlement routes | Main full suite passes; Business routes located | Business grant workflow and real owner session unverified | Validate one available grant with fixture data and replay |
| Audit / permissions | Main authorization modules and transaction reasons; Business `audit.ts`, `tenant.ts` | Main authorization negative tests pass; Business scope SQL inspected | Business end-to-end tenant isolation not established by root tests | Run Business-specific cross-tenant read/write tests |

The origin branches above were inspected without merging them into this branch.
Open PR search also found #98, #165 and #179; kiosk and patch retirement are
outside this stage. PR #174 head `776c70d` has successful release, VK parity
and public startup workflows; #176 head `2f98f39` has a failed release gate.
Main commit's PR-workflow lookup returns no runs, which is not evidence of
failed main CI.

## Selected stage and result

The full baseline root npm audit reports 3 moderate entries in express,
body-parser and qs, caused by two qs advisories:

- https://github.com/advisories/GHSA-4mjr-xmp4-gh2g
- https://github.com/advisories/GHSA-x5fp-wj9c-mxmx

Upgrade within Express 4: 4.22.2 → 4.22.3; its existing transitive packages
body-parser 1.20.6 → 1.20.8 and qs 6.15.3 → 6.16.0. No new dependency,
override, service, environment variable or route change. npm also reconciles
the stale lockfile root version to the unchanged package.json version.
Both servers continue using the existing shared root dependency tree; their
canonical source is unchanged. No design or tenant model change.

This removes known vulnerable HTTP dependencies used by the admin service.
Both advisory defects were reproduced against the original qs in isolation.
This does not establish exploitability of either defect on production routes:
the documented attacks depend on particular parser options or serialization
flows. No hostile request was sent to production.

## Checks

- Node 24.19.0, npm clean install with lifecycle scripts disabled.
- Three new regression tests: comma-array limits, malicious constructor
  round-trip, real local Express HTTP query/JSON parsing and malformed JSON.
- `npm run materialize` twice: identical SHA-256 manifests for tracked files.
- `node --test`: 439 passed, 0 failed/skipped, including existing authorization,
  broadcast duplicate/error and adjustment validation tests.
- `npm run check`: passed.
- Full `npm audit`: 0 vulnerabilities (baseline: 3 moderate).
- VK startup parity: passed.
- Public read-only probe: 16/16 reachable responses for Telegram and VK,
  health/readiness report release `18a0fa4`, DB OK and child ready.
- Materialized runtime outputs restored to canonical source before commit;
  only package metadata, lockfile, regression tests and this report are saved.

## Limits and next stage

No production DB writes, migrations, bulk broadcasts, merge or deploy.
No authenticated admin browser session or real cash credentials available in
this run. Desktop/mobile UI not exercised because this stage changes no UI.
Root tests do not certify the separate Business branch's integration suite.

Next small stage: diagnose the existing Business release-gate runner mismatch
blocking PR #176, preserving separate Node and Vitest test coverage. It should
be a separate change, not bundled with this dependency security fix.

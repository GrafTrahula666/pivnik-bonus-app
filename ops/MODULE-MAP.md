# Module map and "do not break" list

## Evotor durable store binding (2026-10-26, UNMOUNTED)

Manual additive Admin migration `024_evotor_store_bindings.sql` (after 020/021,
not startup-applied) creates one unique (product_id,store_id) binding. The
server-only `evotor-market-store-binding.ts` calls the existing
`withEvotorOwnerBindingGuard` to consume an HMAC one-time proof, verify the
complete provider GET /stores and current token revision, then persist the
binding inside canonical owner/session/company/venue/provider `FOR SHARE`
locks. Identical fresh verified retries are idempotent; a verified competing
owner/company/venue claim makes a **sticky hold** committed before returning
409. Neither retries nor token rotation clear hold/revoked; a newly verified
proof can refresh a pending revision. Diagnostic reads recheck current owner
session and provider install/reconciliation/revision, return no foreign scope,
and NEVER authorize CRM, fiscal data or license. New records stay `pending`;
there is no `ready` transition or HTTP route. Native PG negative/concurrency
regression: `server/tests/evotor-market-store-binding-postgres.spec.ts`,
`evotor-owner-nonce-postgres.yml`. No production migration, merge or deploy.
OAuth `state` echo and live provider owner proof are still external P0 gates.


## Evotor durable OAuth state (2026-10-26, UNMOUNTED)

`admin-platform/server/evotor-market-oauth-state.ts` and manual additive Admin migration
`023_evotor_oauth_states.sql` add a cryptographically random 32-byte OAuth
state stored only by SHA-256, tied to the current Admin session token hash,
canonical owner/company/venue, fixed productId and server-configured HTTPS
redirect. Issuance checks active account/session, company/venue and owner-only
grant with SQL row locks. Consumption serializes competing callbacks with
`FOR UPDATE`, rechecks the same session and current grants under `FOR SHARE`,
then marks the state consumed in one transaction. Invalid foreign session,
redirect or product cannot burn another session's state. Expiry is 5 minutes,
checked with `clock_timestamp()` after any lock wait. No provider token/code
is stored in the state table. Native PostgreSQL tests:
`admin-platform/server/tests/evotor-market-oauth-state-postgres.spec.ts`,
CI: `evotor-owner-nonce-postgres.yml`.

This is a CSRF/session-binding prerequisite, **NOT Evotor identity proof**.
It has no HTTP route, OAuth issuer, signed store proof, license, binding write,
production migration or provider call. Never enable it until the independent
provider owner verification and full P0.2 authorization chain are implemented.

## Evotor OAuth authorization_code transport (2026-10-26, UNMOUNTED)

`admin-platform/server/evotor-market-oauth-exchange.ts` adds a fail-closed, bounded server-side OAuth code exchange using the official `https://oauth.evotor.ru/oauth/token` endpoint, Basic client credentials, exact registered HTTPS redirect URI and mandatory `store:read` scope. Redirects, non-200, malformed/oversized/stalled responses and provider errors fail without disclosing tokens. It intentionally returns only access token, expiry and scope, never refresh token, user identity, owner proof, binding, tenant or license. A real issuer still needs session-bound durable one-time OAuth state, independent store/user ownership verification, canonical grants, current token revision and transactional binding checks. No HTTP route, production config, migration or provider call is mounted. Synthetic negative tests: `server/tests/evotor-market-oauth-exchange.spec.ts`.

Written 2026-09-28 after a live audit of the running code (not from memory/docs).
Purpose: ground any future "cut by layers" work in what is actually here, so a
refactor doesn't quietly drop an edge case that only exists as inline logic.

## Evotor Market store evidence adapter (2026-10-25, not mounted)

`admin-platform/server/evotor-market-stores.ts:verifyEvotorMarketStores` is an
unmounted read-only building block. It uses server-supplied cloud credentials
and expected provider user, fixed `https://api.evotor.ru/stores`, both v2 headers,
Bearer auth and opaque encoded cursors. Every store must match the exact user;
only a complete chain ending in empty paging returns immutable ID/user records.
Non-200, foreign owner, malformed data, duplicate IDs/cursors, redirects or caps
fail closed without partial results. One 15s deadline covers headers and streamed
bodies across all pages; bounds are 50 pages/5000 stores, 1MiB per page/5MiB total.
Timeout/late-response cleanup and secret-free errors have focused tests.
`verifyEvotorMarketStoresAtRevision` is an additional unmounted server-only
wrapper: it requires a trusted primary-DB revision reader, denies missing/stale
revision before provider GET and rechecks after complete pagination. Revocation,
rotation or DB read errors fail closed without returning store evidence. Its
revision checks are not owner proof and cannot replace atomic binding-time
revision/grant verification. Negative tests cover mid-flight revoke.
It has no route, feature switch, environment mutation, DB writes or live caller.
It does not prove canonical company ownership, installation, selected-store
binding, terminal allocation or license. Empty stores proves no ownership.
Integration must recheck current canonical grants and unchanged token revision,
provider identity, installation/hold state and exact store before persisting any
binding. No legacy POS source is changed. See `EVOTOR-MARKET-RUNBOOK.md`.

`admin-platform/server/evotor-market-binding-guard.ts` is an additional **unmounted** transaction prerequisite (Draft #302). It checks the exact selected provider store via the complete server-side GET, verifies a short-lived one-time claim including **canonical venueId**, then under native PostgreSQL FOR SHARE locks rechecks active session/account, canonical company/venue, exact owner grant (not trusted director), installed/unheld provider identity and token revision. It runs a future idempotent binding write only through the same transaction client. Missing, foreign, revoked or rotated state denies. No route, issuer, license, runtime revocation enforcement, binding table or production call exists. Native tests/CI must be verified independently.

`admin-platform/server/evotor-market-owner-proof.ts` is a separate **unmounted**
server-side one-time signed-claim verifier. It requires an exact SPACEVERSE
session/provider/product/company/venue/store/token-revision scope, a short-lived
HMAC claim, and an atomic durable nonce-consumption callback. Missing, expired,
replayed, foreign, malformed or wrong-key claims fail closed. Its signing key
must never be browser-controlled. The new **unmounted**
`evotor-market-owner-proof-issuer.ts` consumes the single-use session-bound OAuth
state, exchanges the authorization code only with server credentials, checks
complete provider stores against an installed callback identity and current
token revision, then rechecks canonical owner grants and provider state under
PostgreSQL row locks before signing a 5-minute-or-less claim. The expected
provider user is only a lookup hint, never sufficient ownership evidence.
Native PostgreSQL negative tests and CI cover the issuer. It is NOT a mounted
HTTP route, an authorized provider launch, a license or a tenant activation.
Official OAuth `state` echo and live owner/store E2E remain unverified.
The separate unmounted `evotor-market-owner-nonce.ts` provides a fail-closed
native PostgreSQL insert-if-absent nonce consumer, with manual additive Admin
migration 022. It hashes nonces before storage and rejects replay/expired claims;
a new disposable PostgreSQL regression and dedicated CI workflow are prepared,
but results must be verified before integration. Migration 022 is **not applied**
to production and the consumer is **not mounted**. A valid internal signature
is NOT Evotor ownership evidence. No HTTP route, tenant activation, provider
call, license or production integration is added.


## SPACEVERSE Evotor signed license policy (2026-10-26, UNMOUNTED)

`admin-platform/server/evotor-market-license-policy.ts` evaluates ONLY a
server-signed, independently provider-verified license claim plus current
installation, subscription, store-binding and explicit approved license policy.
It rejects missing contract/plan approval, unknown unit, pending/held binding,
sequence gaps, user/subscription reconciliation, expired periods, stale token
revision, scope substitution, unapproved trial/grace and terminal widening.
`admin-platform/server/evotor-market-license-guard.ts` additionally locks canonical
owner/session/company/venue, provider installation, exact subscription and
store binding in a single native PostgreSQL transaction before any authorized
callback. Its native test uses a disposable test-only CHECK relaxation to
simulate a future `ready` binding; this is NOT a production migration.
The existing store-binding migration 024 has no `ready` state, and there is NO
trusted license issuer, runtime SQL reader, billing or HTTP consumer. Thus no
production row can be licensed through this module. Synthetic unit tests do
NOT establish Evotor commercial authorization. Do not use browser fields or
callback `active` as an entitlement. No changes to existing routes, bonuses,
Telegram/VK, kiosk, production migrations or tenant activation.

## Admin Pilot Marketplace inbox (2026-10-23, default off)

`admin-platform/server/evotor-market.ts` handles only POST `/api/v1/user/token`,
`/api/v1/installation/event` and `/api/v1/subscription/event` before the browser
Admin router. `ADMIN_ENABLE_EVOTOR_MARKET_WEBHOOKS=false` hides these routes.
Enabling requires a UUID4 product, exact strong app-level Authorization and
the existing onboarding secret keyring. Manual Admin migration 020 contains
provider identities, encrypted tokens, durable deduplicated events and a
contiguous subscription projection; none is a new tenant or company grant.
Unknown properties/products/versions, conflicting retries and cross-user
subscriptions fail closed. Event and projection commit together before 200;
SQL/commit failures return 503 without provider/SQL/credential text. Uninstall
cannot be undone by an older install. Sequence gaps are explicit; large
contiguous backlogs drain in batches. Terms/add-on changes require review.
Termination requested remains resumable, distinct from terminal termination.
No token consumer, tenant binding, license authorizer, commercial activation,
provider call or billing is introduced. App-vs-user notification auth differs
between official documents and remains a mandatory real-provider test gate.
See `EVOTOR-MARKET-RUNBOOK.md` and `ADMIN-PILOT-MARKET-PROGRESS.md`.
`server/tests/evotor-market.spec.ts` exercises real HTTP and disposable SQL;
`SPACEVERSE_TEST_NATIVE_POSTGRES_URL` selects independent native connections.
This Admin-only mount has no duplicate route in root `server.js` or
`universal-server.js`; neither root server is changed by this feature.

25 October hardening requires manual Admin migration **021 after 020**. Conflicting
same-key deliveries preserve only the changed SHA256 plus the original event key
and set sticky `reconciliation_required` on the **original** provider user and
subscription before returning 409. Failed writes/COMMIT return 503 without a
partial hold; exact retries, token rotation and later events cannot clear it.
An installation conflict remains ambiguous across reinstall. There is no reset
API/reconciler yet. A later sequence with a different provider userId for the
same subscription also persists a sticky hold on the ORIGINAL subscription before
409 (503/rollback if COMMIT fails). Its conflicting event is durable evidence,
but the original user row is not additionally locked, avoiding a cross-user
lock-order deadlock. A future license consumer must check BOTH user and subscription
holds, installation, complete sequence and fresh verified canonical ownership;
another subscription's `active` projection alone never authorizes access.
A termination request after terminal termination now enters `review_required`,
so a subsequent renewal cannot reopen it. HTTP/disposable SQL regression covers
identity substitution, concurrent retries and failure recovery. No customer or
financial tables, root route copies or startup migrations are changed.

`auth.ts:login` retains the six-attempt IP/account limit and adds independent
30-per-IP and 15-per-normalized-account limits per 15 minutes, before password
SQL/scrypt. `login-rate-limit.spec.ts` covers rotating identities/IPs and expiry.
Limits are process-local, not a distributed ingress protection guarantee.

`ProductionCRM.tsx` now requests bounded 100-row pages with offset and accessible
Previous/Next controls. Search/sort/segment changes reset the page; exact-path
results hide stale rows and reject late responses. Existing keyed scope/drawer
isolation remains. `data.ts:getClients` orders by typed numeric balance/spend
and timestamp sources (not response text aliases), then `u.id ASC` for stable
ties. Native PostgreSQL integration covers 205 equal-sort customers, a foreign
bar and 9/20/100 numeric ordering; existing legacy tenant guard is retained.
`crm-pagination.config.ts` and its named fixtures run desktop/mobile browser
regressions. Ordinary offset pagination does not promise a frozen snapshot
while another operator changes the database. Vitest is pinned to 4.1.12 to fix
the two currently reported moderate dev-only @vitest/mocker advisories.

## Owner network search (2026-10-19, existing default-off workflow gate)

`GET /api/admin/onboarding/venues` accepts optional `q` (up to 100 characters,
no control characters) alongside `offset`. The existing authorized canonical/
draft union is deduplicated, then filtered by literal case-insensitive venue or
company name before pagination. Scope parameters and repeated parameters remain
invalid; search cannot add a company grant. Nonempty responses echo trimmed `q`;
the old empty-query response is unchanged. `OwnerVenues.tsx` submits explicitly,
resets pagination, retains the applied query on refresh/load-more, and rejects
late or mismatched-query responses. Empty search results differ from no venues.
No target/provider queries, schema/CI/production changes or new tenant model.
Native HTTP/SQL and built desktop/mobile tests cover 301+ matches, both owned
companies, inaccessible companies and literal wildcard text. This retains the
existing metadata-directory scan; performance at thousands of tenants is not
claimed. See `ops/SPACEVERSE-OWNER-VENUE-SEARCH-RUNBOOK.md`.

## Standalone CRM metadata preparation (2026-10-19, default off)

`ADMIN_ENABLE_CRM_ONBOARDING=false` gates POST
`/api/admin/onboarding/drafts/:id/crm/prepare` and the corresponding wizard mode.
The command accepts only `draftRevision`; signed session, Origin/CSRF, current
onboarding write grants and actor rate limits are mandatory. It reuses
`prepareOnboardingScope`'s canonical transaction/source locks. A missing existing
app-config record is created from server defaults (venue name, shop off,
loyalty on), with the same deterministic tenant key, then the canonical inactive
scope is prepared atomically with audits. An existing configuration is preserved.
Retries/concurrent identical commands return the same scope; audit failure rolls
back profile/company/venue/scope together. No second tenant, migration, target DB
or provider provisioning, guest bundle, launch or license is introduced.
`VenueOnboarding.tsx` hides guest branding in this mode, submits one preparation
command and restores actual scope after an uncertain response. Off keeps the
previous application/scope workflow. See `SPACEVERSE-CRM-PREPARATION-RUNBOOK.md`.

## Internal onboarding support queue (2026-10-19, default off)

`server/onboarding-support.ts` adds GET/POST `.../drafts/:id/support` under
`ADMIN_ENABLE_ONBOARDING_SUPPORT=false`, reusing the existing draft/canonical
scope and revocable owner/manager grants. Manual Admin migration 017 stores
only a server UUID, creator, draft, enumerated topic, recorded status and time.
The draft lock plus unique `(draft_id,topic)` makes concurrent retries return
the same request. Grant/account locks and atomic scoped audit protect writes;
missing schema/audit failures never become successful or empty results.
No free text, credentials, invitation URLs, customer data or provider prose is
stored. GET `/api/admin/onboarding/support` is a bounded, audited internal queue
for current active SUPER_ADMIN only, not a developer integration invitation.
`OnboardingSupport.tsx` in the existing wizard restores requests after reload
or lost responses, rejects contradictory scope/delivery and isolates late
responses. `OnboardingSupportQueue.tsx` appears on the platform operator page.
Recorded means saved, never read/assigned/resolved or externally delivered.
No external messaging, customer/runtime/financial writes, activation, migration
autostart or production switch change. Existing copy-to-developer flow remains.
Runbook: `SPACEVERSE-ONBOARDING-SUPPORT-RUNBOOK.md`; signed HTTP/native SQL:
`server/tests/onboarding-support.spec.ts`; built desktop/mobile E2E:
`SPACEVERSE_E2E_SUPPORT=true` with `playwright.tenant-crm.config.ts`.

## Owner list: saved CRM activation state (2026-10-19, default off)

`onboarding-venues.ts` optionally includes a sanitized `crmActivation` summary
under the existing `ADMIN_ENABLE_TENANT_CRM_ACTIVATION_CHECKS` switch. It reuses
the provisioning service's prepared source/ledger checks, revalidates the read
grant and frozen manifest, and exposes no target credentials or customer data.
Company owners retain all stores of every company they own; a store-scoped
employee invitation does not replace or narrow those company grants. Tests use
a regular VENUE_ADMIN owning two companies and three stores, without SUPER_ADMIN.
Scoped viewers can read a summary without gaining check/run permission. Refresh
reads metadata only; it neither probes the target/provider nor claims an attempt.
The shared projection in `tenant-crm-activation-state.ts` distinguishes saved
results, no check and unavailable state (unknown attempt count, never false zero).
An expired lease requires attention, and a more severe current cash failure takes
precedence over a saved CRM blocker. Optional guest bundle/image failures do not
select the CRM action. No summary can report active/approved; the existing
migration 016 and activation defaults remain unchanged.
`OwnerVenues.tsx` and `tenant-crm-activation-summary.ts` validate draft/company/
venue and reject unverified activation, including a contradictory active row.
The old list contract remains unchanged when the switch is off. Existing active
venues without an onboarding binding retain their previous unknown connection.
Native signed HTTP/SQL and built desktop/mobile checks extend the same activation
fixtures; no new API, migration, tenant model, write capability or CI settings.

## Standalone CRM activation check (2026-10-19, default off)

`ADMIN_ENABLE_TENANT_CRM_ACTIVATION_CHECKS` exposes GET/POST
`/api/admin/onboarding/drafts/:id/crm/activation-check` in the existing router and
`TenantCrmActivationCheck.tsx` in the same wizard. POST accepts only `{}`;
session, Origin/CSRF and actor rate limits remain mandatory. Manual Admin
migration 016 extends the existing provisioning ledger with `crm_activation_check`
and forbids its `succeeded` status. No second tenant/registry/invitation model.
`onboarding-provisioning.ts` reuses its claim/lease/token/retry mechanism, depends
on schema readiness only, then rechecks real target binding/schema/ownership in
bounded REPEATABLE READ READ ONLY SQL. Guest bundle/image is not required for
the standalone CRM. Completion rechecks active account, current scoped grants,
frozen source and lease, and atomically audits its blocked result. Lost leases
and audit failures cannot publish completed evidence. Existing guest step guards
are unchanged. `tenant-crm-readiness.ts:tenantCrmProviderReadiness` shares saved
POS evidence freshness validation; the local projection can require credential
decryption before use. A fresh provider still ends in Market-contract-required.
No network provider verification, license adapter, canonical activation or active
CRM resolver is introduced. UI resumes the server operation after reload and
rejects purported success/scope changes. See
`ops/SPACEVERSE-CRM-ACTIVATION-CHECK-RUNBOOK.md`, signed HTTP/native SQL tests in
`server/tests/tenant-crm-activation.spec.ts` and the built desktop/mobile scenario
selected by `SPACEVERSE_E2E_CRM_ACTIVATION=true` in `playwright.tenant-crm.config.ts`.

## SaaS readiness research and CRM scope lifecycle (2026-10-18)

`server/database-transport.ts` addresses the external Admin pool certificate-
validation risk in the CRM TLS slice.
All three pools in `db.ts` and the existing onboarding target registry share
this policy: exact private/local host exceptions, verified public TLS, explicit
IP identity checking, and removal of pg URL TLS overrides before pool creation.
Unsafe query host/credential/TLS/file overrides fail closed without logging
credentials. Existing read-only options, scope guards and default-off writes
remain. `server/tests/database-transport.spec.ts`, `database-pools.spec.ts` and
registry tests inspect the actual pg parser; `scripts/verify-database-tls.mjs`
uses synthetic loopback certificates and real pg TLS handshakes, not a live DB.
An additional isolated native PostgreSQL 16 smoke verifies authenticated TLS 1.3
and CA/hostname rejection; its owned container is stopped after the proof.
See `ops/SPACEVERSE-DATABASE-TLS-RUNBOOK.md`; actual production CA/connectivity
and deployment approval remain external gates.

The next default-off Admin diagnostic is documented in
`ops/SPACEVERSE-TENANT-CRM-READ-RUNBOOK.md`: `server/tenant-crm-read.ts` composes
the existing customer-wallet repository, onboarding access/runtime source and
target registry. `GET /api/admin/onboarding/drafts/:id/crm/customers/:userId`
requires `ADMIN_ENABLE_TENANT_CRM_READS`; target transactions are read-only,
permissions/source are rechecked, and successful access is audited in metadata.
It works on prepared/inactive drafts and explicitly returns not_provisioned.
It does not activate a venue, replace the active CRM reader or check a POS/license.
The customer-directory slice (#285) adds `customer-directory-repository.js`
with the wallet repository's shared verified-binding SQL and an optional
collection suffix at the same draft URL (q/limit/offset only). It shares the
read-only/source-revalidation/audit service and actor rate limit with detail
reads. `TenantCustomerDirectory.tsx` is gated by the default-off session
capability inside the existing `VenueOnboarding`; it does not activate a venue.
`playwright.tenant-crm.config.ts` exercises the built App and real frozen registry
on three dedicated local native PostgreSQL targets, including disabled mode.
The directory/UI was merged in #285 after the read diagnostic #284.
The readiness slice #286 adds GET
`.../crm/readiness` with the same read/access/audit boundary. It uses a real
scoped DB count and the existing encrypted POS projection; saved provider
checks are not new live probes. `tenant-crm-readiness.ts` rejects stale/future
or incomplete evidence and leaves subscription/activation unconfigured/pending.
`TenantCrmReadiness.tsx` shows these gates in the existing wizard, default-off;
no canonical active flag or guest runtime changes. Contract and verification
are in `ops/SPACEVERSE-CRM-READINESS-RUNBOOK.md`.
Signed HTTP regression is in `server/tests/tenant-crm-http.spec.ts`, using the
same seed in PGlite or opt-in native PostgreSQL. The native fixture requires a
local test database/role, creates dedicated databases, and pins pool clients
through the real read-only transaction. Production-mode image/real registry
smoke and native checks are documented in the runbook/progress.

Current source-backed product status, competitor evidence, external publication
gates and implementation sequence are in `ops/SAAS-PRODUCT-AUDIT.md`,
`ops/SAAS-COMPETITOR-RESEARCH.md`, `ops/EVOTOR-MARKET-REQUIREMENTS.md`,
`ops/SAAS-PRODUCT-ROADMAP.md` and `ops/SAAS-ANALYTICS-AI-ARCHITECTURE.md`.
Marketplace terms remain unverified after official-site HTTP 403; AI is a future
independent add-on whose architecture is specified, with no adapter implemented
or external AI calls in this iteration. Neither research
nor the existing onboarding artifacts mean a commercially activated tenant.

`admin-platform/src/App.tsx` keys the production CRM by actor/company/venue;
changing scope immediately discards its list, filters, selected customer and
forms while the next request is pending. `ProductionCRM.tsx` keys its drawer by
scope/customer and ignores obsolete detail responses. This is a UI lifecycle
boundary, not a replacement for existing server authorization. Browser fixtures
in `e2e/crm-scope.spec.ts` reproduce same-company venue and cross-company switches
and delayed responses; `playwright.evotor.config.ts` runs them on desktop/mobile
alongside existing cash dashboard checks. No production APIs are called by them.

## Owner panel appearance and cash interval (2026-10-25)

### Evotor stock intake safety (2026-10-25)

PR #309 introduced the intake screen; #310 changed it to the existing cloud
products, selected by product ID and measured in liters. `server/evotor-stock.ts`
uses the metadata DB for its operation journal and the existing production reader
for the exact company/venue `pos_store_bindings` lookup. It does not own a second
inventory balance. `server/evotor-stock-client.ts` pins the official Cloud V2 host.

The absolute PATCH path is quarantined by `evotor-stock-safety.ts` before any
operation reservation, database write or provider write, including when all three
feature flags are on. A local advisory lock and a successful read-back cannot
prevent lost terminal sales. Listing preserves actual products but returns
`writeEnabled:false` and an explicit block reason rendered by `BeerIntake.tsx`.
Removing this gate requires a verified provider-side atomic delta/CAS or safe
receipt-independent stock document contract and concurrent-sale acceptance.
No environment variable alone supplies that proof.

Live read-only preflight: metadata venue 1/company 1 maps to enabled store
`20241111-E9DB-403D-8079-3522141697B9`. The existing token reads stores/documents
(HTTP 200), while products return HTTP 403. `admin-pilot` now uses server-only
Railway references to the existing token/store; both intake flags remain false.
Migration 019 is absent and is intentionally not applied while writes cannot be
enabled. No stock, guest, wallet, receipt or payment data was changed.

Evidence, provider constraints and the remaining release gates are recorded in
`ops/SPACEVERSE-EVOTOR-STOCK-PREFLIGHT-20261025.md`. Adapter race tests, service
boundary tests, actual HTTP director restrictions and UI gate tests cover this
boundary. The requested end-to-end intake is **not operational**.

`admin-platform/src/spaceverse.css` is the final presentation layer imported by
`src/main.tsx`; it preserves the existing page components, handlers and RBAC.
`src/branding.ts` centralizes brand raster paths. `Login.tsx` keeps the existing
auth/demo/invitation flow; `BlackHole.tsx` animates only the background, with a
static image fallback, reduced-motion support and a pause control. The cube
logo is stationary in the upper-right corner.

`phaseC/SalesDashboard.tsx` adds inclusive `from`/`to` controls to the existing
POS read endpoint. `cash-period.ts` follows its existing 1–366-day/Moscow
contract. `CashDashboard.tsx` switches the existing `summary.hours` and
`summary.days` projections without changing totals, products, comparison,
permissions, monetary logic or API contracts. Arbitrary-day and preset controls
remain. `pages/Dashboard.tsx` initially shows four demo KPIs and keeps all twelve
available behind an accessible expand control; production cash KPIs are unchanged.

Browser coverage: `e2e/owner-design.spec.ts`, custom interval coverage in
`e2e/evotor-sales.spec.ts`, existing scope and comparison checks, all run by
`playwright.evotor.config.ts` on desktop/mobile with synthetic fixture data.
Release evidence and the separately discovered dependency blocker are recorded
in `ops/SPACEVERSE-OWNER-DESIGN-20261025.md`. No root runtime route changes.

## Application operations overview: calendar filters (2026-10-25)

The production owner overview source "Операции приложения" is separate from
POS cash "Все продажи кассы" and "Клиенты приложения". Its new signed,
venue-authorized GET /api/admin/venues/:id/dashboard/operations route uses
server/data.ts:parseOperationsPeriod; existing /dashboard still uses parsePeriod
for unrelated analytics, with unchanged daily time semantics and no extra hourly query. Accepted filters: preset 1/7/14/30/90/365
Moscow calendar days, one date, or inclusive from/to (1..366 days).
Future/invalid/mixed/duplicated date parameters fail closed with HTTP 400;
the old POS read endpoint and monetary logic are unchanged.

The dashboard's existing readPool legacy-bar membership boundary and only
completed transaction timestamps power a second, bounded-by-range SQL aggregate
for 24 Moscow-hour buckets. Day grouping now uses the Moscow timezone as well.
The new operations field counts completed transaction ledger entries rather
than falsely relabeling purchase checks. Empty time buckets render as zero
only when that completed ledger is the source; visits and app opens remain
unavailable without events. Both aggregates retain the exclusion of manual
personal gift credits from bonus-earned totals. The existing stock indicators
(total customers, bonus balance) are snapshots, not historical counts.
The previous equal-length period is still the comparison baseline.

src/phaseC/ProductionDashboard.tsx shows the same period selection as POS
and switches between actual hourly and daily series, without inserting a
second global date control. No modifications to billing, kiosk, guest apps,
migrations, roles, write methods, patch-chain, or server.js/universal-server.js.
Server date tests: server/tests/operations-period.spec.ts.
Client controls: src/tests/app-operations-periods.spec.ts.
Read adapter for other tenants remains fail-closed pending trustworthy
venue-attributed data.

## Business venue audit isolation (2026-10-17)

`admin-platform/server/admin-metadata-read.ts:getAdminAudit` filters venue audit
by both the resolved company ID and venue ID; company-level and other-venue
entries are excluded. The existing `/api/admin/venues/:venueId/audit` router
resolves current account access before reading. Query parameters cannot replace
that scope. `/api/admin/audit` retains global entries for SUPER_ADMIN only.
`server/tests/audit-venue-scope.spec.ts` covers SQL isolation;
`server/tests/audit-http.spec.ts` exercises signed sessions, both routes,
same-company venues, cross-company denial and access revocation through actual
HTTP and disposable PGlite. No schema or write-path change is required.

## Business onboarding drafts (2026-10-12, opt-in)

`admin-platform/server/venue-onboarding.ts` and the existing Business router own
the draft API. With the invitation flag off it remains SUPER_ADMIN-only.
`server/onboarding-access.ts` adds scoped owner/manager/viewer access through
existing canonical company/venue IDs and the revocable invitation access ledger;
it does not introduce another tenant model. Mutations lock their grants until
COMMIT and recheck exact draft scope. `src/phaseC/VenueOnboarding.tsx` extends the real
Business App. Additive admin migrations 004, 005 and 006 are separate from
guest/startup policy; `ADMIN_ENABLE_ONBOARDING_DRAFTS` defaults off and also
requires the global write switch. Drafts and their standard application blueprint
are scoped to their creator, versioned, idempotent and audited. Migration 005
reserves a stable `sv-*` tenant key and requires `dedicated_database`; the API
contract remains `not_provisioned`, `published=false` and `legacyDataAccess=false`.
Migration 006 lets an explicit `PUT .../scope` atomically reserve the canonical
company/venue IDs. A new company and every new venue are created with
`active=false`; no access row is granted, and source revisions are frozen after
preparation. The operation is replay-safe and audit failure rolls back the scope
and both canonical rows. Inactive scope rows remain invisible to the normal venue
resolver. It does not create an active company/venue, database, bot, webhook or POS link.
Manual admin migration 011 extends the existing 007/008 invitation table with
server-owned canonical scope, role and replay fields, and adds revocable access.
No second invitation or tenant model is introduced.
`server/onboarding-invitations.ts` owns issuance, exact replay, expiry, acceptance
and revocation; `ADMIN_ENABLE_ONBOARDING_INVITATIONS` defaults off. Tokens use a
domain-separated HMAC of the existing strong Admin CSRF secret; only their hash
is stored. Tokens/passwords are excluded from audit and browser storage. An
accepted invitation creates an Admin account only when its email is new; an
existing account must log in. Accepting/revoking access and auditing are atomic.
`OnboardingInvitations.tsx` and `InviteAcceptance.tsx` connect the owner link to
the real resumable wizard, with server-provided per-draft write permissions.
Organization owners can delegate their prepared inactive organization or point;
a point grant cannot expose another point in that company. No messaging is sent.
Runbook: `ops/SPACEVERSE-VENUE-ONBOARDING.md`. Browser checks use real signed
Admin HTTP and SQL fixtures on desktop/mobile (`test:e2e:invitations`). Runtime
provisioning and live terminal verification remain pending; prepared metadata
never means an active venue. When the scoped invitation flag is on, legacy
issuance/claim is disabled and old links require reissue from «Приглашения».
Legacy rows and independently granted company rights are retained.
Manual admin migration 012 stores only the operator checkpoint, terminal ID/name
and cash-report choice for the existing draft. `server/onboarding-workflow.ts`
derives the eight step statuses from canonical company/venue, frozen application,
existing provider verification and provisioning ledger; request statuses and
scope are rejected. `GET/PUT .../progress` share the same revocable read/write
permissions, revision/replay checks and atomic audit. `OnboardingProgress.tsx`
restores these choices after reload. `ADMIN_ENABLE_ONBOARDING_WORKFLOW` defaults
off. A configured terminal has no confirmed binding/event yet; its status stays
pending. Missing connection returns unavailable report data with null amounts,
never invented zero revenue. A database binding or readable provider documents
do not mark a venue active or an application published.
Manual Admin migration 015 adds encrypted POS proxy settings and a leased,
audited verification result to the same draft. `server/onboarding-pos-proxy.ts`
resolves its HTTPS origin from protected references in
`ADMIN_ONBOARDING_PROXY_REGISTRY_JSON`; UI input cannot choose an address,
runtime or scope. `ADMIN_ENABLE_ONBOARDING_POS_PROXY` defaults off and requires
the workflow switch. Network work runs outside SQL transactions; completion
rechecks lease, source revisions, terminal and revocable access.
`routes/spaceverse-pos.js` mounts behind the existing tenant startup guard in
both root servers. It rechecks the exact runtime binding and live POS device
scope in SQL and requires `X-Pivnik-Device-Key`. Manual root migration 021 stores
only idempotent test-event receipts; no customer/bonus/receipt writes occur.
`pos/onboarding-proxy.js` defines the v2 nonce/MAC contract shared with Admin.
Verification requires a fresh terminal event and complete fresh provider sync.
An empty verified 24-hour report returns 0 receipts/0 cents; unavailable data
returns null, and a zero-value receipt is still data. Device credentials cannot
read financial/customer rows. A successful connection probe does not bypass
`SPACEVERSE_RUNTIME_NOT_PROVISIONED`, deploy or activate a venue.
`server/onboarding-venues.ts` provides the authenticated read-only owner list
(`GET /api/admin/onboarding/venues`, 25 entries/page) under the existing default-off
workflow switch. It combines the canonical active-venue resolver with scoped
draft access; inactive prepared points reuse `onboarding-workflow.ts` projection.
Company/venue/status input cannot choose scope. An existing active metadata row
without verified connectivity remains pending/unknown, never false connected or
zero revenue. Device and operator activity are distinct. `OwnerVenues.tsx`
refreshes results and resumes the selected real wizard, including a repeated
open of the same draft. Its developer request copies owner text and non-secret
connection diagnostics only; it neither sends messages nor records a delivered
ticket. SPACEVERSE branding and general navigation omit legacy PIVNIK-only
reward/broadcast/content controls while that flow is enabled. Mobile Integration
Hub/OAuth/sandbox/developer integration grants remain a separate future scope.
`spaceverse-runtime-release.js` fingerprints the two Node entrypoints, their
literal relative import/re-export/dynamic-import closure and package/lock files.
The explicit local builder writes a new non-secret release record; no code is
executed and no database/service is started. `onboarding-runtime-release.ts`
uses operator-only file/SHA/fingerprint registration and rechecks actual files.
Production bundle verification requires this proof; description-only success
from the earlier ledger is projected as action_required and safely reclaimed
for verification. Shared bundle v2 includes the code proof in its digest; v1
remains readable. Neither version authorizes launch. Coverage is Node literal
imports, not a hermetic image or arbitrary computed imports/frontend assets.
`scripts/prepare-spaceverse-runtime-image.mjs` creates a new allowlisted local
image context and verifies its copied release. `ops/spaceverse-runtime.Dockerfile`
pins the Node base digest and reinstalls locked production dependencies offline
from a separate public npm cache; cache/logs are tmpfs, host node_modules excluded.
`spaceverse-runtime-image.js` verifies an independently approved immutable local
Docker image ID, platform, code labels, non-root user, exact tenant wrapper and
limited baked environment. The wrapper rechecks bundle/modules and retains the
startup denial without npm prestart, DB access or legacy fallback. A local image
ID is not a registry publication or provisioned service. The existing server-only
assembler now reads protected image ID/inspection-file references, compares image
config/source against the current approved code proof, and emits shared bundle v3
with image identity bound into the same checksum and exact tenant scope. Production
verification requires that proof; v1/v2 ledger success is safely projected/retried
in the same record. Owner workflow distinguishes missing image from verified image
and unlaunched runtime. Approved resumable launch and terminal provisioning remain
pending; no Docker daemon, deployment or image publication is invoked by Admin API.
`spaceverse-tenant-service.js` is a separate default-off tenant API inside the same
approved image. The existing two legacy entrypoints retain their startup denial.
Its container wrapper is now included in the code fingerprint closure, including
literal imports of this service and the existing customer/POS adapters. Startup
requires v3, approved image identity, private per-tenant credentials, the same
verified runtime binding, and an unexpired permission from manual root migration
022. That permission references the existing binding and stores only a token hash;
it is not a tenant registry or an active venue. A held session advisory lock admits
one serving process per runtime. Scope/permission are rechecked before requests;
revocation, suspension, expiry or a changed binding closes serving access.
`spaceverse-runtime-readiness.js` signs/verifies a fresh nonce, exact scope, image,
bundle and permission expiry. Its `tenant-api-only` proof says neither published
frontend nor active venue. No schema/device provisioning occurs at boot; the API
reuses the canonical auth/wallet/POS adapters, has no legacy fallback and leaves
financial routes unavailable. Admin resume orchestration/terminal provisioning
and the public standard application remain pending.
`spaceverse-runtime-manifest.js` now emits the strict checksummed non-secret v2
manifest only after canonical scope exists. It binds draft/application/scope
revisions plus canonical company/venue IDs. A tenant-mode guest process must find
the same IDs and checksum in its dedicated database (manual additive migrations
017 and 018); only then does it receive a verified immutable tenant/location
context. `dashboard-summary-repository.js` has the first tenant-runtime read
adapter: the operational query captures that verified context and rejects
request-supplied scope before SQL. `transaction-persistence.js` now has the
matching write boundary for new operations: it accepts only transaction data,
rechecks the exact runtime/database binding in the same parameterized INSERT,
derives tenant/location from that binding, and uses `request_key` for exact
replay after an uncertain response. A mismatched payload, tenant, location,
database or forged runtime returns no write and never falls back to legacy SQL.
Manual additive migration 019 adds explicit customer ownership without
backfill: every owned user is tied by a composite foreign key to the exact
runtime/company/venue binding. `customer-wallet-repository.js` is the matching
read boundary. It accepts only a canonical user ID plus the privately verified
runtime, rechecks the same binding inside the read query, and can reach
`users`/`wallets` only through the ownership row. Unowned historical rows are
invisible; a different database, tenant or venue is rejected, and request scope
or a copied runtime never reaches SQL. `customer-provisioning.js` is the single
write boundary for a **new** tenant customer. Inside one database transaction it
locks and rechecks the exact binding, records only a UUID/fingerprint in the
manual additive migration 020 ledger, and creates the existing `users`,
`user_identities`, `wallets` and ownership rows. An exact retry (including after
an uncertain COMMIT response) resolves to the same user; a changed payload,
request-supplied scope, another tenant database, or any historical Telegram/VK
identity fails closed instead of adopting that row. The ledger stores no
provider ID or profile data. `spaceverse-customer-auth.js` verifies signed
Telegram/VK identity, accepts existing customers only through exact ownership,
and delegates every missing-customer write to that provisioner; there is no
second auth-specific creation path or ledger. Sessions carry the exact
runtime/checksum/company/venue and every read rechecks identity, ownership,
session version and live binding. A missing wallet is an unavailable
configuration, not a zero balance. `routes/spaceverse-customer.js` is the shared
auth and wallet HTTP adapter mounted by both guest entrypoints behind the same
preflight. It rejects request scope and prevents tenant APIs falling through to
legacy staff, money or PIVNIK-specific handlers. Wallet issuers remain
`not_configured`. Both
`universal-server.js` and `server.js` check this before spawning/initializing any
PIVNIK runtime data. Even an exact binding is deliberately rejected with
`SPACEVERSE_RUNTIME_NOT_PROVISIONED`: the current artifact remains PIVNIK-specific
and the manifest cannot claim publication. With no tenant manifest, the existing
legacy PIVNIK startup path is unchanged and performs no binding query. Continue
from `ops/SPACEVERSE-ONBOARDING-PROGRESS.md`; never store provider keys, database
URLs or other secrets in draft/application JSON or the runtime manifest.

The first provider slice stays in that same master and reuses
`pos/evotor-client.js`; it is not a second integration framework. Manual admin
migration `admin-platform/admin-migrations/009_onboarding_integrations.sql`
stores the exact prepared draft/provider/store binding plus only an AES-256-GCM
envelope, key ID, HMAC request fingerprint and verification state. The keyring is
read only from protected server variables, supports active + previous keys, and a
verification write rewraps the token under the active key. `GET/PUT
.../integrations/evotor` and `POST .../integrations/evotor/verify` use the same draft
read/write permissions behind writes, draft and integration feature flags.
Invited viewers can read masked state; only scoped owners/managers can save or
verify, and revocation is rechecked before recording a verification result.
Responses expose a fixed mask, never ciphertext or plaintext. Verification calls
the existing fixed-host Evotor document-page adapter and records only
`configured`, `verified`, `action_required` or `error`; HTTP 200 without the
expected document shape is an error. This proves read permission only: it does
not create an Evotor account, install an app, bind POS, import receipts, provision
runtime or publish the guest application. Telegram/VK remain external-
authorization work. Do not confuse this admin migration 009 with root
`migrations/009_spaceverse_transaction_scope.sql`.

The first executable provisioning step is isolated in
`admin-platform/server/onboarding-provisioning.ts`. Manual additive admin
migration `010_onboarding_provisioning.sql` stores one
`runtime_database_binding` ledger row per prepared draft. A transaction claims
the row with a short lease; an unexpired claim blocks double execution, while an
expired claim or a recorded safe failure can be retried. The worker reloads the
manifest from the authorized frozen draft/application/scope and resolves the
target database only by that server-derived runtime key. Request data never
contains a database URL or credential. In the already-created dedicated
database, the action requires manual migrations 017/018, inserts the exact
singleton binding if absent, accepts an exact existing binding after an
uncertain response, and refuses to overwrite any mismatch. A successful target
commit and metadata completion are deliberately reconciled rather than treated
as one cross-database transaction. The ledger and audit contain only safe IDs,
checksum, attempts, status and fixed error/result codes.
`server/onboarding-database-registry.ts` now resolves only the exact frozen
runtime key through `ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON`, whose values are
references to separate `SPACEVERSE_TENANT_DATABASE_URL_*` variables. It rejects
embedded URLs, Admin/legacy databases, duplicate targets and duplicate secret
references, and safely rotates bounded pools without exposing driver errors.
`server/onboarding-provisioning-api.ts` mounts creator/scoped GET status and POST
run through the existing Business router behind the separate default-off
`ADMIN_ENABLE_ONBOARDING_PROVISIONING` gate, signed session, Origin, CSRF and
rate limits. POST accepts only an empty object; query/body scope, URL and
credentials are invalid. `VenueOnboarding.tsx` now reloads this ledger after a
prepared scope, starts it with exactly `{}`, blocks double clicks and uses the
server-authoritative `startAllowed` flag so an active lease cannot be repeated
while an expired lease can be reclaimed. Owner-facing copy distinguishes
waiting, verifying, action required, retryable failure and prepared binding;
even success remains explicitly not started and unpublished. The UI accepts no
database field or credential. This step does not create a database, activate a
venue/runtime, run tenant migrations automatically or publish an application.

The second fixed step, `tenant_schema_readiness`, stays in the same
`onboarding-provisioning.ts` service and ledger. Manual additive admin migration
`013_onboarding_schema_readiness.sql` only extends the ledger step constraint
after migrations 010/012. It cannot connect to or mutate a tenant database.
After an exact successful binding, the worker resolves the same server-owned
target and runs one read-only transaction. It verifies the frozen binding,
required canonical columns, critical PK/FK/check/unique boundaries from root
migrations 009 and 017–020, and the absence of customer/wallet/identity/
transaction/create-request rows outside the exact runtime/company/venue
ownership boundary. Results and errors are fixed non-sensitive codes; there is
no row count, identifier, driver text, migration execution, backfill or legacy
adoption. The scoped GET/POST endpoints reuse the same auth, CSRF, Origin, rate
limit and empty-command contract. `VenueOnboarding.tsx` keeps the step locked
until binding succeeds, then restores/retries the server ledger. The shared
`onboarding-workflow.ts` projection reports schema pending/error/ready while
keeping runtime `not_provisioned` and publication false.

The third fixed step, `runtime_bundle_verification`, also uses that ledger and
is added by manual additive admin migration
`014_onboarding_runtime_bundle.sql`. It is locked until schema readiness
succeeds. The shared `spaceverse-runtime-manifest.js` now builds and strictly
parses one deterministic, non-secret bundle contract for the existing
`pivnik-bonus-app` artifact and its two server entrypoints (`server.js` and
`universal-server.js`). The bundle checksum covers the canonical manifest plus
the `tenant-runtime-v1` compatibility contract; it is not a hash or signature
of deployed binaries. The server reconstructs the tenant environment from the
verified bundle and persists only its safe checksum/contract/result summary.
The Admin Docker build now copies the same shared manifest module instead of
depending on a file absent from its image. GET/POST accept no manifest,
artifact, path, URL or credential from the browser. Lease/retry prevents double
assembly, a tampered or incompatible candidate fails closed, and an exact
reopen returns the saved result. Success still records `not_provisioned`,
`published=false` and no start permission: it does not launch a process, set
Railway variables, resolve a database credential, build the VK static client or
attest a deployed release SHA.

## The honest starting picture

This is **not** a single ball of mud. ~20 small, single-purpose modules already
exist (`achievements.js`, `wheel.js`, `qr-resolver.js`, `platform-core.js`,
`authorization-*.js`, `*-transaction-persistence.js`, `broadcast-campaign-store.js`,
`admin-user-directory.js`, `dashboard-summary-repository.js`, …). Business logic
and persistence are already reasonably separated. **The actual monolith is the
route wiring**: two huge files that register and inline-handle HTTP routes.

| File | Lines | Role |
|---|---|---|
| `server.js` | 3392 | Express app. 59 routes. Runs as an internal-only child process (`PIVNIK_CHILD_SERVER=1`, listens on `127.0.0.1:<internalPort>` only). |
| `universal-server.js` | 3432 | Raw `http.createServer` public gateway on `0.0.0.0:<publicPort>`. Spawns `server.js` as a child, proxies most traffic to it, but **re-implements 35 of its own paths directly**, some of which are the *only* implementation the public internet ever reaches. |
| `app.js` | 3599 | Entire client SPA: all screens, all API calls, all rendering. Single file, no bundler. |
| `index.html` | 1004 | Shell markup + a large amount of inline `<script>`/CSS the client relies on. |

Total across these four: ~11,430 lines. This is the real size of the "cut by
layers" job — bigger than the patch-chain, and the part with the most user-facing
risk if split carelessly.

## The two-server split is the sharpest edge

`universal-server.js` does not proxy everything. It **directly implements**
(never forwarding to `server.js`) 12 paths, split into two genuinely different
situations — conflating them was the one inaccuracy an earlier pass of this
document had:

**A) Truly duplicated — `server.js` defines the exact same path independently**,
with its own copy of the handler logic (verified by path, not assumed):
`/api/auth` (`server.js:1580`), `/api/me` GET (`server.js:1674`),
`/api/me/consent` (`server.js:1721`), `/api/me/beta-tester/claim`
(`server.js:1738`), `/api/leaderboard/monthly` (`server.js:1893`),
`/api/staff/activate` (`server.js:2066`), `/api/staff/qr/resolve`
(`server.js:2108`), `/api/admin/users` (`server.js:2911`).

These are **not dead code** — they're what runs when a test imports `server.js`
directly, or if `server.js` is ever run standalone — but in the real deployed
gateway path, the `universal-server.js` copy wins and `server.js`'s copy for
these specific paths is never reached by real traffic.

**Consequence for any refactor:** if you change auth, staff-activation or
similar behavior, you must change it in `universal-server.js`, and you
should check whether `server.js`'s same-named route needs the identical change
for test/standalone parity — they are two independent implementations today,
not one shared handler.

**B) Gateway-only — `server.js` has no route for this path at all**:
`/api/bootstrap`, `/api/wheel/status`, `/api/wheel/spin`,
`/api/account-link/*`. There is nothing to keep in parity here, but it means
searching only `server.js` for these will find nothing, which is its own trap.
The wheel is the sharpest case: it calls into `wheel.js` for the prize
table/draw, then does its own transaction/wallet SQL inline
(`spinTelegramWheel`, `universal-server.js:1858`) — there is no
`server.js`-side wheel logic to fall back to or compare against.

## Route inventory (everything else — `server.js`, proxied as-is)

By rough domain, all still living as inline Express handlers in `server.js`:

- **auth/me**: `/api/auth`, `/api/me`, `/api/me/account` (delete), `/api/me/profile`,
  `/api/me/consent`, `/api/me/qr`, `/api/me/transactions`, `/api/me/beta-tester/claim`,
  `/api/me/messaging-config`, `/api/me/marketing-consent`, `/api/me/achievements/:code/ack`
- **wallet/bonus**: `/api/wallet/config`, `/api/wallet/apple`, `/api/wallet/google`
- **shop**: `/api/shop/catalog`, `/api/shop/contact`, `/api/shop/inquiries`,
  `/api/staff/shop/purchase`, admin shop-items CRUD
- **staff**: `/api/staff/session`, `/api/staff/activate`, `/api/staff/qr/resolve`,
  `/api/staff/transactions` (+ `:id`, `:id/cancel`), `/api/staff/beer-gift`,
  `/api/staff/recent`, `/api/shift/current`
- **admin**: `/api/admin/shift`, `/api/admin/summary`, `/api/admin/broadcast(/preview)`,
  `/api/admin/users` (+ `:id/role`, `:id/pin`, `:id/reissue-qr`, `:id/adjust`,
  `:id/cancel-limit/reset`), `/api/admin/transactions` (+ `:id/cancel`),
  `/api/admin/inquiries` (+ `:id`), `/api/admin/content`, `/api/admin/promotions`
  (CRUD), `/api/admin/design/*`
- **achievements/leaderboard**: `/api/achievements`, `/api/leaderboard/monthly`

(`/api/account-link/*`, `/api/bootstrap` and the wheel are gateway-only — see
"Gateway-only" above, they are not in this file.)

## The prestart/materialize patch chain

`npm start`'s `prestart` runs `scripts/apply-*.mjs` in a fixed order before
`node universal-server.js`; `npm run materialize` runs the equivalent subset
without the Telegram/DB-specific steps. **This is a real, previously-documented
risk** (`docs/vk-startup-forensic-20260913.md` already flagged it: "the archive
overwrite is proven architectural risk"), not a new finding.

**2026-09-28: retired `apply-icecream69a-frame.mjs`** as the proof-of-concept
for this process (see git history / PR for the exact commit). Its diff — a
small, self-contained per-username avatar frame, touching only `app.js`,
`server.js`, `styles.css`, `universal-server.js` and never auth or money — was
copied into canonical source, the script deleted, and it was removed from
`prestart`, `materialize`, `check` and the `APPROVED_PRESTART_COMMANDS`
allowlist in `scripts/audit-runtime-patch-chain.mjs` in the same change.
The process: run the script against a scratch copy to get its exact diff,
copy the already-verified patched files into canonical source (not retype
them — the script's own internal assertions already proved the diff
correct), remove it from all four places that reference it by name, then
re-run the full regression bar below — **plus** diff the fully materialized
runtime files before/after against the pre-retirement baseline, since a
retired script's canonical-source diff can silently change how a *different*,
still-active script behaves (see "Hidden dependencies" below; both
retirements so far have hit this).

**2026-09-28: retired `apply-frame-shop-polish.mjs`** the same way, surfacing
two hidden dependencies fixed in the same change (see below).

**2026-09-28: retired `apply-v22-production-polish.mjs`** the same way. **10
scripts remain.** Its whole diff was two SQL fragments in
`universal-server.js`'s auth/account-link paths (`COALESCE` guards so a
partial re-auth payload can't null out an existing `photo_url`,
`provider_username` or `profile_url`) plus its own idempotency-marker
comment, which was dropped rather than folded in since nothing else reads it
now that the script and its self-referential tests are gone. No new hidden
inter-script dependency was found in the runtime files themselves — this
script's two anchors were unique to it, and the fully materialized
`universal-server.js` before/after this retirement is byte-identical except
for the now-dead `// PIVNIK_V22_PRODUCTION_POLISH_20260827` marker comment
disappearing (nothing else ever read it); the fully materialized `server.js`
has no diff at all. What *did* need cleanup: two pre-existing test
files (`test/v22-production-polish-retirement.test.js`, and one test block
inside `test/v22-production-polish.test.js`) asserted on the *script's own*
before/after execution rather than on canonical-file outcomes; both
necessarily went away with the script file they read, per the same
"delete what the deleted script's own tests exercise, leave outcome-only
tests alone" rule already applied to `test/frame-shop-polish.test.js`
surviving the previous retirement untouched.

**2026-09-28: retired `apply-red-cosmos-v2-shell-final.mjs`** the same way.
**9 scripts remain.** This script only ever wrote `index.html` (it read and
asserted against `app.js` but never wrote to it); on `origin/main` at
retirement time its diff was already a near no-op — the canonical
`styles.css`/`app.js` cache-busting query strings and the "strip legacy
visual layer" regexes were all already satisfied — so folding it in meant
adding exactly two `<link>`/`<script>` tags right after the canonical
`styles.css`/`app.js` tags (`/service-white-gold.css`, `/red-cosmos-v2.js`)
and dropping its own idempotency marker comment
(`<!-- RED_COSMOS_V2_FINAL_SHELL -->`), which like the v22-production-polish
marker before it, nothing else reads. One real hidden dependency was found
and fixed: `apply-v22-product-rebuild.mjs` (invoked by the still-active
`apply-v22-runtime.mjs`, which runs *before* where shell-final used to sit)
temporarily wires `/v22.css` and `/v22-ui.js` into `index.html` as part of
its own migration — its own `verify()` even asserted they were present —
on the assumption that shell-final would immediately strip them again a few
steps later in the same `materialize`/`prestart` run, the way it always had.
With shell-final gone, nothing did, so the first post-retirement
materialized `index.html` still had these two legacy tags wired — a real,
observable runtime regression the byte-diff below caught immediately.
Fixed by moving that exact strip (the same two regexes shell-final used)
into `apply-v22-product-rebuild.mjs` itself, right after it wires the tags,
and flipping its own `verify()` check from "these must be present" to
"these must be absent" — restoring the original final behavior without
touching anything else in that script. No other active patch script touches
this part of `index.html` (`apply-release-candidate-fixes.mjs` only edits
regex literals embedded in `universal-server.js`'s own source, not
`index.html` directly; `apply-working-updates.mjs` edits an unrelated
theme-color meta tag and two unrelated HTML fragments further down the
file). What *did* need cleanup on top of that: **ten** test files read the
script file directly to assert its own internal constants/regexes
(`CANONICAL_STYLE_VERSION`, `forbiddenVisualAssets`, `SERVICE_STYLE_HREF`,
etc.) rather than the canonical `index.html` outcome those constants
produce; each was rewritten to assert the same fact against `index.html`
(and `app.js` for the `SPACEVERSE_CANONICAL_THEME_LOCK` check) directly, and
one redundant script-only assertion in `test/v22-production-polish.test.js`
(prestart still containing this script's name) was removed outright.

**2026-09-28: retired `apply-red-cosmos-v2-client-final.mjs`.** **8 scripts
remain.** Client-only (`app.js` alone; never touches the DB, auth/session or
server money-paths), but a large diff, and the retirement with the most
subtle hidden-dependency trap so far.

**The trap:** running the script standalone against raw canonical `app.js`
gives the *wrong* diff. Its wheel-guard and `APP_VERSION` edits are real
no-ops (canonical `app.js` never had `IS_VK` wheel guards and the committed
`APP_VERSION` already read `'20.0-spaceverse-purple-home'`), but its frame
patch is not: the script's frame-class insertion branches on whether a
`middle-finger` line already exists in `app.js` at the moment it runs. That
line does not exist in *committed* canonical `app.js` — it only exists
*transiently*, added a few steps earlier in the same `prestart`/`materialize`
run by `apply-v22-product-rebuild.mjs` (invoked internally by the
still-active `apply-v22-runtime.mjs`, step 2, well before where client-final
used to sit at step 4). Run the script against committed source directly
and it takes the *other* branch, inserting four new lines after `vladislav`
that never actually fire in real production. The only way to get the real
diff is to reproduce the real chain order: run `apply-v22-runtime.mjs`
first, snapshot `app.js`, *then* run client-final and diff from there. Doing
that gives the true, much smaller diff: `selectedShopItem` set to a real
frame code, **one** new `avatarFrameClass()` line (`premium-smiling-fuck`,
inserted right after the `middle-finger` line that `apply-v22-product-rebuild.mjs`
itself creates), **one** new emoji-map entry (same idea, in that script's
`v22Orbits` map), both QR helper texts swapped, the achievement summary
copy changed, `APP_VERSION` flipped from the intermediate
`'22.0-pivnik-rebuild'` to the final `'20.0-spaceverse-purple-home'`, and —
the biggest piece — the whole `shopActionLabel`/`renderShopCatalog` block
replaced with the contents of `scripts/fragments/red-cosmos-shop-client.fragment.txt`
(adds `RED_COSMOS_SHOP_FRAMES`, `shopFrameOwned`, `shopFramePreviewMarkup`
and `buyShopItem`, replacing the old category-grouped/`data-shop-inquiry`
shop renderer with the direct-buy `data-shop-buy` one).

**The two real hidden dependencies, both in `apply-v22-product-rebuild.mjs`
(the sub-step `apply-v22-runtime.mjs` invokes, running well before where
client-final used to sit):** it creates the `middle-finger` frame-class line
and `v22Orbits` emoji entry that client-final's `premium-smiling-fuck`
insertion depended on, and it unconditionally sets `APP_VERSION` to the
intermediate `'22.0-pivnik-rebuild'` — client-final was the only thing that
ever flipped it back to the final value, in a later, separate script
invocation within the same `materialize` run. With client-final retired,
first materialize after this change left `app.js` with `APP_VERSION` stuck
at `'22.0-pivnik-rebuild'` and the `premium-smiling-fuck` frame-class/emoji
entries silently absent — both real, observable regressions the
before/after byte-diff caught immediately, not something visible in a
standalone script run. Fixed minimally: `premium-smiling-fuck` was added to
`apply-v22-product-rebuild.mjs`'s own `middle-finger`
frame-class/`v22Orbits` insertions (right next to where it already creates
those anchors), and `apply-v22-runtime.mjs` gained one small block, run
*after* its own existing verification already passed, that flips
`APP_VERSION` from the intermediate value to the final one before finishing
that step — mirroring exactly what client-final used to do, just one script
earlier in the chain. Neither script's own existing checks were touched.
One line in the original script (adding a `'premium-smiling-fuck': '🖕'`
emoji-map entry keyed off a **top-level** `'middle-finger': '🖕'` anchor,
a *different* map than `v22Orbits`) is a genuinely separate,
**pre-existing, already-silent no-op in current production** — that
specific anchor string does not exist anywhere in materialized `app.js`
either, so that particular guarded `replace` never fires; left untouched
and documented here, not fixed, since it predates this retirement.

No other hidden inter-script dependency was found beyond the two above:
no other active script touches `shopActionLabel`/`renderShopCatalog`/
`RED_COSMOS_SHOP_FRAMES`/the QR texts (`apply-release-candidate-fixes.mjs`
only adds a click handler that *calls* `renderShopCatalog()`, never edits
its body; `apply-working-updates.mjs`'s only overlapping area is the
unrelated profile frame-*picker*, not the shop). The fully materialized
`app.js` before/after this retirement is byte-identical except for the now-
dead `// RED_COSMOS_V2_FINAL_CLIENT_RUNTIME` marker comment disappearing
(nothing else reads it, consistent with the others). `index.html`,
`server.js`, `universal-server.js` and `red-cosmos-v2.css` are all
untouched by this retirement, confirmed by the same worktree diff.
`scripts/fragments/red-cosmos-shop-client.fragment.txt` is **not** deleted
in this change — per scope, it's flagged here as a cleanup candidate for a
future PR, since after this retirement no active script reads it anymore
(only two test files read its raw content for assertions, which still work
with the file left in place).

**2026-09-28: retired `apply-vk-production-hotfix-20260831.mjs`.** **7
scripts remain.** Touches `app.js` (VK photo-button actionability and an
on-demand VK photo refresh flow on the avatar-source picker) and appends a
CSS block to `red-cosmos-v2.css` (`PIVNIK_VK_COSMOS_BACKGROUND_20260831`,
the VK background/transparent-inner-canvas fix); only *reads* and asserts
against `vk-platform.js`, never writes it (those hooks already live in
canonical source). Both diffs were clean, unambiguous single-target
anchors — unlike the client-final retirement, nothing here depends on
another active script's transient state, so a standalone script run gave
the true diff directly.

**The hidden dependency this retirement was chosen to prove out:** this
script ran *after* `apply-working-updates.mjs` in the old chain (position 7
of 7 remaining, one before `red-cosmos-v2-db-prepare.mjs`), and
`apply-working-updates.mjs` restores `red-cosmos-v2.css` from its
gzip+base64 blob by **wholesale overwrite** whenever the file doesn't
already match the blob's snapshot exactly — the same mechanism that broke
`apply-frame-shop-polish.mjs`'s CSS during its own retirement (PR #162).
Once the `PIVNIK_VK_COSMOS_BACKGROUND_20260831` block was folded into
canonical `red-cosmos-v2.css`, the *next* `materialize` would have hit
`existing !== targetContent` inside `apply-working-updates.mjs`'s restore
loop and silently wiped the VK background CSS back to the blob's older
snapshot. Fixed the same way as PR #162: decoded the blob, appended the
exact same CSS fragment (extracted from the retired script's own
`vkBackgroundFix` template literal) to its `red-cosmos-v2.css` entry,
re-gzipped, re-base64'd, and re-split into the same 3-file,
16000-char-chunk convention (`scripts/working-updates-runtime-*.txt`);
round-trip decode verified before committing. The blob's
`red-cosmos-v2.css` entry now carries both this fix and the frame-shop-polish
one from PR #162.

**A separate, genuinely pre-existing bug, left untouched and documented
here rather than fixed:** the folded-in `app.js` code calls
`applyVkProfileHydration(hydration)` on a successful on-demand VK photo
refresh — but no function of that name exists anywhere in the codebase
(`app.js`, `vk-platform.js`, or anywhere else). This is not something this
retirement introduced; it is exactly what the script has been shipping to
production already. Because the call sits inside a `try`, the resulting
`ReferenceError` is caught by the surrounding `catch` and surfaces as a
generic "не удалось загрузить фото VK" toast — a real, silent regression in
that one on-demand-refresh code path (the hydrated photo data returned by
`refresh()` never actually reaches `state`), but pre-existing and out of
scope for this PR per the "don't use a found bug as an excuse to fix it"
instruction. No other active script references `applyVkProfileHydration`,
the VK photo button logic, or the `PIVNIK_VK_COSMOS_BACKGROUND_20260831`
CSS block, so there is no second hidden dependency to trace here.

Ran the existing conservative audit tool as of this writing
(`npm run audit:runtime-retirement`, canonical phase):

```
Conservative retirement candidates: 0
Startup side-effect review required: 1 (scripts/repair-telegram-runtime.mjs — external network call)
```

**The remaining 7 scripts are still classified as required**
(`materialized-release-step` or `keep-database-step`) by the tool's own
conservative criteria. This means the easy part of "kill the patch chain" is
already done (there's history of `retirement-materialize-once.yml` /
`retirement-materialize-v22-preflight-once.yml` workflows that already retired
earlier patches into canonical source, and now this one) — what's **left
active is the harder remainder**, not low-hanging fruit. Retiring any one of
these means: read exactly what it changes, move that change into the
canonical source file it patches, delete the apply-script, remove it from
`package.json` (`prestart`/`materialize`/`check`) and from
`APPROVED_PRESTART_COMMANDS` in `scripts/audit-runtime-patch-chain.mjs`, run
the audit tool again to confirm it now reports the retirement as safe, and
keep `npm run check` + full `node --test` + materialize-idempotency green
throughout.

Scripts, in prestart order, and what each one touches (from
`scripts/audit-runtime-patch-chain.mjs` static-target detection):

1. `repair-telegram-runtime.mjs` — Telegram bot menu API call; no file writes.
2. `apply-v22-runtime.mjs` — `achievements.js`, `app.js`, `index.html`, `server.js`,
   `universal-server.js`; triggers steps 2b/2c below.
3. `apply-red-cosmos-v2-backend-final.mjs` — `server.js`, `universal-server.js`.
4. `apply-release-candidate-fixes.mjs` — `app.js`, `index.html`, `red-cosmos-v2.css`, `universal-server.js`.
5. `apply-working-updates.mjs` — the biggest one: `app.js`, `index.html`,
   `platform-core.js`, `red-cosmos-v2.css`/`.js`, `universal-server.js`,
   `vk-platform.js`, plus two DB/audit scripts. Ships as a gzip+base64 blob
   (`scripts/working-updates-runtime-*.txt`) decompressed at apply time.
6. `red-cosmos-v2-db-prepare.mjs` — DB backup + frame-ownership reconciliation (guarded by `DATABASE_URL`/production checks).

~~`apply-icecream69a-frame.mjs`~~ — retired 2026-09-28, folded into `app.js`,
`server.js`, `styles.css`, `universal-server.js` directly.

~~`apply-frame-shop-polish.mjs`~~ — retired 2026-09-28, folded into `server.js`,
`universal-server.js`, `red-cosmos-v2.css` directly.

~~`apply-v22-production-polish.mjs`~~ — retired 2026-09-28, folded into
`universal-server.js` directly.

~~`apply-red-cosmos-v2-shell-final.mjs`~~ — retired 2026-09-28, folded into
`index.html` directly.

~~`apply-red-cosmos-v2-client-final.mjs`~~ — retired 2026-09-28, folded into
`app.js` directly (`scripts/fragments/red-cosmos-shop-client.fragment.txt`
kept, no longer read by any active script — cleanup candidate, not deleted
in this change).

~~`apply-vk-production-hotfix-20260831.mjs`~~ — retired 2026-09-28, folded
into `app.js` and `red-cosmos-v2.css` directly; the
`working-updates-runtime-*.txt` blob was regenerated so its
`red-cosmos-v2.css` snapshot carries the VK background CSS too (see below).
**7 scripts remain.**

~~`apply-red-cosmos-v2-tester-claims.mjs`~~ — retired 2026-10-02, folded into
`universal-server.js` directly: the `claimPendingSpecialAchievement()` helper
(calls `pivnik_claim_pending_special_achievement`) and its one call right after
`createSession()` in the shared provider login path (VK and Telegram). The true
diff was taken in real chain order (after `apply-red-cosmos-v2-backend-final.mjs`);
no other script reads its marker or helper. Fully materialized files before/after
are byte-identical except the dead `// RED_COSMOS_V2_PENDING_TESTER_CLAIMS` marker
comment, and materialize stays idempotent. **6 scripts remain.**

### Hidden dependencies this second retirement surfaced

Retiring one patch script can make an *unrelated, still-active* script behave
differently, because several of them do bare-substring "is this already
applied?" checks against the whole file rather than checking their own exact
target text. Two were found and fixed this time, both in
`apply-red-cosmos-v2-backend-final.mjs` (step 5 — runs long before where
`apply-frame-shop-polish.mjs` used to sit at step 12):

- Its `addPremiumFrameSupport()` guarded on the bare substring
  `"'premium-smiling-fuck'"` to decide whether its own patch (adding
  `premium-smiling-fuck` to an allowed-frame array and a `frames.push()`
  branch) had already run. Once `apply-frame-shop-polish.mjs`'s
  `OWNER_FRAME_CATALOG` — which legitimately lists every frame code,
  including this one — became permanent canonical source in
  `universal-server.js`, that bare check read "already applied" and silently
  skipped this script's real, unrelated patch for the gateway. Fixed by
  checking for its own exact target string instead, **for the gateway path
  only**.
- **The `server.js` path was deliberately left on the old, bare check.**
  Tracing the *original*, unretired chain step by step proved this script's
  `server.js` patch was **already a no-op in current production**, for an
  unrelated reason: its `"'money', 'fire', ...'middle-finger'"` anchor simply
  does not match `server.js`'s actual array text, so `String.replace()`
  silently returns the input unchanged (no exception — `replace()` never
  throws on a non-match) — and the old bare check then still read "applied"
  for an unrelated reason (a different, adjacent `replace()` in the same
  function *does* match `server.js`, adding a `frames.push()` line whose text
  happens to satisfy the same bare substring test). That bug is real, but
  it predates this retirement and this retirement does not touch it —
  fixing it here would have been exactly the "use it as an excuse for
  extra scope" this process is supposed to avoid. It's flagged here as a
  known, separate, pre-existing defect for whoever picks it up next.
- `apply-working-updates.mjs` (step 9) restores `red-cosmos-v2.css` from a
  compressed, versioned blob (`scripts/working-updates-runtime-*.txt`) by
  **wholesale overwrite**, not an anchor-based patch. Its blob predated
  `apply-frame-shop-polish.mjs`'s shelf-animation CSS, so once that CSS was
  folded into canonical source, this step's overwrite silently deleted it
  again on every `materialize`. Fixed by regenerating the blob itself (same
  gzip+base64 format, same 3-file split) to include the shelf-animation CSS
  permanently, rather than changing this script's overwrite mechanism.

None of these three fixes change any script's target behavior versus current
production — each was verified by diffing the fully materialized
`server.js`, `universal-server.js` and `red-cosmos-v2.css` before and after
this retirement (byte-identical for the first two; same CSS rules, just
inserted earlier in the file, for the third).

Step 9 (`apply-working-updates.mjs`) is the one this session already had to
extend twice (once for the admin-XSS fix, once historically for the
`scheduleFallback` safety fix) — every time canonical source changes something
this script's blob also touches, the script's marker-matching breaks loudly
(`throw new Error(...)`), which is exactly the safety net working as intended,
but it is also the clearest sign this script is the most expensive one to keep
alive long-term.

## Old RED COSMOS theme: where it still lived (audited 2026-10-01)

The canonical client palette is white / milk / cream / gold (SPACEVERSE).
What actually ships after `npm run materialize` / `prestart`:

- Linked CSS, in order: `styles.css` → `/loader-fix.css` (inserted by
  `renderAppIndex()` in `universal-server.js`) → `/service-white-gold.css`.
  The same order goes into the VK Hosting bundle (`build-vk-hosting.mjs`
  reuses `index.html`). The final `:root` palette in `styles.css` is already
  white-gold without any JS.
- **Deleted, never linked:** `red-cosmos-v2.css` and `v22.css` (2026-10-06),
  `black-frosted-*.css`, the root and `assets/loader-*` images and
  `assets/backgrounds/pivnik-{loader,sign,boot-person}` (2026-10-01). No page,
  the VK bundle included, ever loaded them. For the two CSS files the patch
  chain was edited too: `apply-working-updates.mjs` drops the blob's
  `red-cosmos-v2.css` entry instead of restoring it and no longer patches it,
  `apply-release-candidate-fixes.mjs` no longer patches it,
  `apply-v22-product-rebuild.mjs` no longer wires and strips `/v22.css`, and
  the gateway's `/red-cosmos-v2.css` route is gone. Materialized
  `app.js`/`index.html`/`server.js`/`universal-server.js` are byte-identical
  apart from that route.
- **The one live burgundy source was the archived `red-cosmos-v2.js` in the
  `working-updates-runtime-*.txt` blob.** Canonical `red-cosmos-v2.js` has no
  theme code, but `apply-working-updates.mjs` replaces it wholesale with the
  blob copy at materialize, and that copy carried `applyPlatformChrome()`,
  which set the Telegram header/background/bottom bar to `#260718` /
  `#0d0002` / `#120006`. Telegram showed a burgundy bar and background during
  load, and kept it whenever no published design record reached
  `applyDesign()`. VK stubs those Telegram calls, which is why only Telegram
  showed it.
  Fixed the same way as PRs #162/#163: the function and its call were removed
  from the blob's `red-cosmos-v2.js` entry (decode → edit → gzip → base64 →
  the same 3-file 16000-char split). The canonical file still carries the
  `EXPECTED_PRIMARY` anchor that the restore loop requires.
- `app.js` now sets the cream Telegram chrome from `renderCoreProfile()`
  through `applyTelegramChrome()`, so it no longer depends on a design record.
  Dark chrome (`#0b0e13` / `#0e0c0a`) is left in place on purpose while the
  boot screen is up. After that the header is cream `#fbf6ef` (dark
  `#0b0e13` only in the Halloween night theme), locked by
  `test/service-entry-canonical.test.js`.
- Left on purpose: `verifyTheme()` in the blob `red-cosmos-v2.js` has no visual effect: it logs
  a failing `console.assert` for `--primary-red` and adds an unused
  `red-cosmos-v2` html class. The semantic danger/error reds and the
  fire/Anna/Olesya avatar-frame art are product colours, not theme.
- VK Hosting is a separate static deploy (manual
  `vk-native-hosting-production.yml`, no runs recorded in Actions; last DEV
  deploy 2026-09-18, from before white-gold landed on 2026-09-22/23). If
  `vk.ru/app54694987` is served from VK Hosting, it shows whatever bundle was
  last uploaded until someone redeploys it.

## "Do not break" — invariants the test suite already enforces

These are not aspirational; each is a real assertion already running in CI.
Treat this as the regression contract for any refactor:

- **Materialize is idempotent.** `release-gate.yml` runs `materialize` twice and
  diffs the tree; a refactor that breaks this fails CI directly.
- **Migration 007 is never rewritten; new data goes in migration 008+.**
  (`test/source-invariants.test.js`, guarded by `apply-working-updates.mjs`
  itself at runtime too.)
- **`qr_aliases` self-aliases (revoked codes) never resolve a client; merge
  aliases still do.** (`test/qr-resolver.integration.test.js`, added 2026-09-27.)
- **Telegram/VK profile names are HTML-escaped in the admin data panels.**
  (`test/audit-hardening-20260927.test.js`, added 2026-09-27 after a stored-XSS fix.)
- **`sendTelegramMessage` has a hard timeout** so a stalled Telegram API can't
  hold a pooled DB client forever. (Same test file.)
- **Broadcast sends are deduplicated** by `(channel, audience, message-hash)`
  fingerprint with a 10-minute advisory-lock window; a repeat send inside that
  window returns the already-completed result or a 409, never a second send.
  (`test/broadcast-campaign-store.test.js`.)
- **Platform separation**: Telegram and VK identities/sessions/roles stay
  distinct in the shared DB (`test/merge.integration.test.js`, `authorization-*`
  test files, `platform-core.js` role-resolution logic).
- **Wheel prize odds and the 1-in-1,000,000 jackpot gate are computed
  server-side** via `crypto.randomInt`, never trusted from the client
  (`wheel.js`, covered by `test/wheel-client-retry.test.js` and others).
- **Staff cancellation quota / unlimited-bonus / suspicious-transaction alert
  thresholds** are enforced in `server.js`'s staff-transaction handlers, not
  the client.
- **VK client bundle never leaks a Railway or Vercel browser origin**, and
  never bundles the Telegram WebApp script
  (`test/vk-native-hosting-main-parity.test.js`, `scripts/build-vk-hosting.mjs`).

Full current baseline: **433/433** `node --test` passing after `npm run
materialize`, `npm run check` clean, `npm audit --omit=dev --audit-level=high`
clean, VK parity 10/10, VK bundle builds clean. This is the regression bar for
every step below.

## My assessment of the proposed plan

Agree with the core call: **do not rewrite.** The database schema, role model,
platform-separation logic and the achievements/wheel/QR edge cases already
have real tests protecting them; a rewrite would have to rediscover all of
that from scratch with no equivalent safety net for months.

Two adjustments to the plan as written:

1. **"Убрать patch-chain" is not one step, it's ~13 separate, sequenced PRs**,
   each gated by the audit tool going from "still required" to "safe to
   retire" for that one script. Scheduling it as a single line item will make
   it look stalled; it should be tracked script-by-script.
2. **The layer cut should target the route files, not the already-extracted
   modules.** "Вынести shop" in practice means: create `routes/shop.js` (or
   similar) that `server.js` mounts, moving the shop-related `app.*(...)`
   registrations and their inline handler bodies out, while the actual shop
   logic stays in `shop-purchase-persistence.js` as-is. Same for staff, admin,
   auth, wheel — the last one specifically has to be *added* to `server.js`
   consistently or explicitly documented as gateway-only, not just moved.

## Progress

1. **This document** (done) — no code change, establishes the shared map.
2. **Proof-of-concept retirement of `apply-icecream69a-frame.mjs`** (done,
   2026-09-28) — proved the read-diff-move-delete-reverify workflow end to
   end.
3. **Retirement of `apply-frame-shop-polish.mjs`** (done, 2026-09-28) — same
   process, this time surfacing and fixing two real hidden inter-script
   dependencies rather than zero (see above).
4. **Retirement of `apply-v22-production-polish.mjs`** (done, 2026-09-28) —
   same process; touched only `universal-server.js`'s auth/account-link
   `COALESCE` guards, no new hidden inter-script dependency in the runtime
   files, but two pre-existing tests bound to the script's own execution
   had to go with it (see above).
5. **Retirement of `apply-red-cosmos-v2-shell-final.mjs`** (done, 2026-09-28)
   — same process; touched only `index.html` (two `<link>`/`<script>`
   tags). Surfaced one real hidden inter-script dependency: a still-active
   sub-step (`apply-v22-product-rebuild.mjs`) temporarily wired `/v22.css`
   and `/v22-ui.js` expecting shell-final to strip them a few steps later,
   the way it always had; fixed by moving that exact strip into the
   dependent script itself (see above). Also, ten pre-existing tests that
   read the script file directly to check its own constants had to be
   rewritten against the canonical `index.html` outcome instead.
6. **Retirement of `apply-red-cosmos-v2-client-final.mjs`** (done,
   2026-09-28) — same process, client-only (`app.js` alone), but the
   trickiest hidden-dependency case so far: a standalone script run gives
   the wrong diff because the script's own frame-patch branches on state
   `apply-v22-product-rebuild.mjs` creates transiently a few steps earlier
   in the same run. Two real hidden dependencies found and fixed there
   (a missing `premium-smiling-fuck` frame-class/emoji entry, and
   `APP_VERSION` left stuck at an intermediate value) without touching
   either script's own verification logic; one separate, genuinely
   pre-existing no-op left untouched and documented (see above).
   `scripts/fragments/red-cosmos-shop-client.fragment.txt` kept in place,
   flagged as a future cleanup candidate now that nothing active reads it.
7. **Retirement of `apply-vk-production-hotfix-20260831.mjs`** (done,
   2026-09-28) — same process; the diff itself was clean and unambiguous
   (`app.js` VK photo-button flow, one CSS block in `red-cosmos-v2.css`),
   but confirmed the exact `apply-working-updates.mjs` blob-overwrite hidden
   dependency this script was chosen to test for: its wholesale-restore of
   `red-cosmos-v2.css` from the gzip+base64 blob would have silently wiped
   the newly-canonical VK background CSS on the very next `materialize`.
   Fixed the same way as PR #162 — regenerated the blob to include the new
   CSS. One separate, genuinely pre-existing bug (`app.js` calls an
   undefined `applyVkProfileHydration` function on VK on-demand photo
   refresh) found, left untouched and documented (see above). **7 scripts
   remain.**
8. **Next candidate**: not chosen yet. Take it only after this one is
   reviewed and merged — one script at a time, per the original instruction,
   not several in a row. Prefer another small, isolated one over
   `apply-working-updates.mjs` (the biggest, blob-based one) until more of
   the smaller scripts are cleared.

Everything past retiring the whole patch chain (route-file extraction by
domain) should wait until the
patch-chain retirement process is proven, since both change the same two huge
files and doing them interleaved would make each harder to review in
isolation.


### Evotor integration draft (2026-10-06)

- Unified window (1.0.16/code20, approved 2026-10-18): the native
  receipt-discount tile is **PIVNIK — БОНУСЫ**. `RedemptionActivity` receives
  foreground scanner/manual codes in the same window, pins resolve/bind to the
  source receipt UUID, and displays identity independently of quote availability.
  Return without redemption uses `IntegrationExit`/KEY_SKIP, preserving discounts,
  positions and payments. The failed product-barcode service/card are removed.
  `BindingPolicy` tracks only live scan tickets, invalidates them on that receipt's
  completion/cancellation or another receipt opening; Bridge releases in finally.
  Existing receipt cleanup and exact-UUID persistent binding remain. No server,
  schema, feature flag or monetary-policy change. Native/fiscal acceptance is
  required. Details: `ops/EVOTOR-BONUS-WINDOW-20261018.md`.
  The 1.0.16 UI fix starts with focus on the window and the soft keyboard hidden;
  manual customer/points fields remain editable on explicit selection. It does
  not change scanner callbacks, receipt state, credentials or monetary rules.

- Fresh closed documents (2026-10-18): `pos/recent-sync.js` reads an overlapping
  two-day API window before historical synchronization. It reuses the exact
  immutable-document importer extracted as `importEvotorDocuments`, has a bounded
  page budget/independent lock, and never changes historical cursor/completion
  state. Failed history cannot hold fresh paid receipts behind its cursor.
  `fetchEvotorPage` adds optional `since` only on the initial page. The existing
  scoped receipt claims and canonical bonus worker remain the only identity and
  monetary path. No migration, flag, tenant model or bonus formula is added.
  See `ops/EVOTOR-RECENT-SYNC-20261018.md` for runtime maintenance evidence.

- Sale loyalty preparation (2026-10-17, separate unshipped draft): an authenticated
  `qr/resolve` caller can explicitly request `includeWallet: true`.
  `pos/loyalty-view.js` returns only a read-only wallet snapshot for the resolved
  live QR, using the serving runtime's existing unlimited policy injected into
  both `createPosHttp` mounts. Legacy requests retain their exact response.
  Missing/invalid wallets fail unavailable, not as a zero balance. Android retains the
  optional balance with the exact receipt binding, expires/clears it with that
  identity and does not treat it as authority to spend. The settings screen
  checks a saved key automatically and shows an explicit successful connection;
  the keyless button moves into diagnostics.
- Native sale loyalty (1.0.13/code17 candidate): `NativeCustomerActivity` is
  launched from the native barcode integration and displays the guest/balance.
  `RedemptionService` declares the native **Списать баллы** receipt-discount tile.
  `RedemptionActivity`, `ReceiptBasket`, `RedemptionJournal` and the pure
  `core/RedemptionOperation` persist an idempotent request before network/SDK
  effects, check exact UUID/basket again, and return a real discount, never a
  fake payment/product. Unresolved redemption prevents replacing the guest;
  the before-positions-edit hook requests cancellation first. It refuses to
  stack over other document discounts or partially paid receipts. No arbitrary
  overlay or permanent native sale widget is installed. Actual POS handling
  of an empty barcode result and all physical till flows remain unverified.
- `pos/redemption.js` adds the guarded financial lifecycle. New reservations
  default off (`PIVNIK_POS_REDEMPTION_ENABLED`). They debit available funds under
  the existing user/wallet and receipt locks, recording a non-purchase adjustment.
  Receipt/client/device and idempotency identity are immutable. Explicit cancel
  requires removal of the receipt effect; a cancel-before-reserve tombstone
  rejects delayed requests. Holds never expire on a timer. The cloud worker
  commits only a matching own-app `extras.pivnikLoyaltyV1` marker plus actual
  discount/net amount, or releases a matching marker with zero document discount.
  Unknown/mismatched effects stay in review. PAYBACK restores spent points by a
  cumulative capped proportion, independently of the ordinary cashback reversal.
  Cancellation/refund credits follow explicit merged_into_user_id edges to the
  surviving wallet without recreating an old wallet; new reservations still
  require the exact active client of the current verified receipt claim.
- The canonical endpoint is `POST /api/device/pos/redemptions`. The installed
  proxy masks also support the same actions over `receipts/bind` with
  `operation: "redemption"`; ordinary `{receiptUuid,payload}` binds stay nonfinancial.
  The gateway forwards both financial transports to the main runtime to use the
  cloud worker's monetary policy, rather than its legacy display/owner policy.
  No new external URL/whitelist or Selectel routing is necessary for the APK.
- Manual additive migration023 and `scripts/evotor-redemption-setup.mjs` prepare
  reservations, cancellation tombstones and refunds. Neither runs on startup.
  `scripts/check-evotor-redemption-concurrency.mjs` is restricted to a fresh local
  `evotor_redemption_test` DB; the integration workflow runs it against PostgreSQL17.

- Selectel ingress draft (2026-10-16,1.0.12/code16): `BridgeSettings` uses the
  verified separate `/evotor` ingress on the existing Selectel hostname.
  `DeviceCredentialStore` explicitly migrates only the old production AAD into
  separate encrypted slots, preserving the original record and Keystore alias.
  Existing/corrupted current records never fall back to a previous identity.
  Optional personal-APK provisioning (`core/ProvisionedKey`) only initializes an
  empty credential store; real keys are absent from Git/public artifacts. The
  permanent certificate is retained. Server route checks passed on the owner's
  VM; real Evotor proxy permissions/device flows and redemption remain pending.

- Proxy response budget (2026-10-16, 1.0.11/code15): `PivnikApi` uses 10-second
  connect and 30-second read timeouts, allowing Evotor's 5+10-second upstream
  budget. Diagnostics retain the POST TLS issuer and elapsed wait on timeout,
  close the failed connection before health, and surface bounded health errors.
  `SettingsActivity` classifies TLS failures by the error line, not issuer names.
  Existing permanent signing identity and encrypted settings are preserved.
  This is a diagnostic update, not proof of terminal connectivity or redemption.

- Foreground scanner draft (2026-10-15): `evotor-bridge` opens
  `CustomerScanActivity`, subscribes to the SDK scanner broadcast only while
  resumed, and passes recognised customer QR through the existing `Bridge`
  receipt-specific resolve/bind policy. `core/ForegroundScan` prevents queued
  double scans and stale customer messages after leaving the window.
  `core/ProxyDiagnostic` classifies proxy 2003 by its structured reason.
  `core/ConnectionCheck` separates the explicit keyless network check from the
  saved-device-key check, accepting only the actual POS refusal envelope.
  The encrypted credential store is unchanged. APK publication requires the
  approved backed-up permanent certificate; no throwaway fallback.
  The owner authorized one reinstall from the disposable 1.0.8 signature;
  local settings require re-entry. The backup restoration/signing test passed.
  This
  changes no server mount, monetary rule or DB schema; real proxy connectivity,
  CI secret provisioning and device behaviour remain unverified. Evidence and
  current blockers: `ops/EVOTOR-AUDIT-20261015.md`.

- `pos/http.js` is the shared dispatcher for native POS device and scoped POS admin
  routes in `server.js` and `universal-server.js`; preserve both mounts on changes.
- `pos/scope.js`, `devices.js`, `repository.js`, `analytics.js`, `service.js` and
  `sync.js` isolate explicit store access, device identity and cash projections.
- `pos-admin.js` / `pos-admin.css` are served by both runtimes and copied by the
  existing VK Hosting builder. Existing staff transactions stay in app operations.
- Migrations 012/013/014/023 are opt-in manual migrations, never part of startup policy.
- `pos/bonus.js` and `pos/redemption.js` are the POS wallet/transaction writers: device
  `receipts/bind` claims plus the `server.js` worker (`startPosBonusWorker`,
  off unless `PIVNIK_POS_BONUS_ENABLED=true`) settle closed SELL/PAYBACK documents
  once each through `pos_bonus_accruals`; reservation/refund reconciliation runs
  before cashback using the same ledger policy. Its ledger hooks sit just above
  `createPosHttp` in `server.js`, outside the slice `evotor-http-boundary` evals.
- `pos/setup.js` + `scripts/evotor-setup.mjs`: the owner's one-off store setup
  (migrations 012–014, binding, operator access, till key). Never on startup.
- `test/evotor-http-boundary.test.js` mounts actual auth/route source on loopback
  with explicit fixture adapters; it does not claim complete production startup.
- See `EVOTOR-INTEGRATION.md` and `EVOTOR-VERIFICATION.md` for the separate Business
  branch, rollback, unresolved real Extras and production approval boundaries.

### Wallet route extraction first stage of P3 (2026-10-10)

- `routes/wallet.js` registers the three existing GET endpoints under `/api/wallet/`.
  `server.js` mounts them at their original position, passing the existing
  `authRequired` middleware and Apple/Google issuer URLs. Handler bodies are
  unchanged apart from indentation. This is pass delivery, not bonus persistence.
- The public gateway continues to enforce consent and proxy these endpoints;
  it has no separate Wallet handler. No gateway, auth, money or patch-chain
  implementation changed. The user explicitly selected this first P3 stage
  while the patch-chain remains active; this does not retire any patch script
  or establish that other domains are safe to extract yet.
- `test/wallet-routes.test.js` exercises the actual mount, existing signed-session
  middleware and gateway consent/proxy source on loopback with fixture DB/profile
  adapters. Evidence and limits: `ops/WALLET-ROUTES-EXTRACTION-20261010.md`.

## Evotor paid draft-beer volume (2026-10-19)

`pos/beer.js` accepts an explicit `operation: "beer"` on the existing device
receipt-bind transport. Selection is pending metadata, fenced by store, receipt,
client, device and QR-claim timestamp. Manual additive migration **024** creates
only selection/audit tables; it is never a startup migration. Old APKs and
cashback continue without 024; new volume writes return 503 until prepared.

Closed paid cloud positions measured in liters cap the selected volume; pieces,
kg and zero-price gifts are excluded. `pos/bonus.js` settles the canonical
`beer_loyalty` row and original transaction beer fields in the same transaction
as cashback: 14 paid liters earn 1 gift liter. No second loyalty counter or staff
purchase is created. Partial refunds reverse only the original
purchase's attributed beer/reward (whole gift liters from its original threshold crossings), retain a remaining original transaction, and
cap cumulative removals. A previously spent gift becomes an audited shortfall
for owner review. Full canonical cancellation must not reverse beer twice.

The native window has a horizontally scrolling row of total-volume choices,
ordinary checkout, and separate reserve / payment controls for redemption.
Initial keyboard focus remains on the non-editable root. Volume saves must be
acknowledged before checkout; actual accrual still waits for the cloud document.
Receipt close/clear/new UUID invalidates customer identity; no global volume is
stored. Do not enable redemption, alter Evotor URL masks, or change the existing
VK/Selectel services as part of this feature.

## Evotor redemption rollout and recovery (2026-10-21)

Current owner request explicitly authorizes enabling POS redemption after readiness
checks; the prior beer-volume-only restriction does not cover this release.
Reservations remain default-off in code. Production rollout uses only
`PIVNIK_POS_REDEMPTION_ENABLED=true`; rollback sets that flag false and keeps POS,
cloud ingestion, bonus worker, device credentials and recovery active.

APK1.0.18/code22 preserves the existing signature, native ruble discount, QR/beer
window and hidden initial keyboard. A deletion broadcast is only a hint: a
persisted exact-UUID deleted fence plus successful empty receipt AND fiscal
provider queries is required before cancellation. Completed/deleted lifecycle and
terminal operation tombstones survive process death and journal cleanup. Recovery
runs separately from checkout, uses exact operation status, rotates bounded
batches and compare-clears only the acknowledged operation. No absence of a
current receipt, timeout, new UUID or unauthenticated broadcast alone credits
points. Late callbacks cannot resurrect or apply a terminal operation.

`pos/redemption.js` commits only the exact requested discount/net effect. Zero
receipt discount cannot refund contradictory discounted net. Manual additive
migration025 adds nullable `pos_documents.redemption_effect` enrichment; normalized
historical snapshots remain byte-compatible. The importer allows unknown→known,
retains known across unknown replay, and rejects conflicting known evidence in
the same immutable fiscal-document transaction. Only explicit discount evidence,
valid marker absence, no distributed discount, and real full-price supported
payments can release a crash-before-SDK hold. Narrow provable review rows may be
rechecked; ambiguous/wrong markers or unknown effects remain in review.

Validation and physical cash/card/remove/delete/restart/return acceptance are
recorded in `ops/EVOTOR-REDEMPTION-ROLLOUT-20261021.md`. No fake product/payment,
manual wallet adjustment, external proxy mask, Selectel/VK change or timer expiry.

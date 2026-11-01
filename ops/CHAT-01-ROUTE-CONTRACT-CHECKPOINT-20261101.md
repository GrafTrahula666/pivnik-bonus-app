# CHAT 01 / task 04 — current module-map and route contract audit

**Date:** 2026-11-01 UTC. **Mode:** isolated documentation-only Draft PR after read-only current source audit. **Pinned** `main c92ed7cd65f1a96d94363c2b7e212424ab078a73`. **Previous checkpoint:** [#342](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/342) (task 03). **Next numbered item:** CHAT01-05, ownership of shared file/API change boundaries. No runtime, CI, secrets, database, environment or device change.

## Read-only evidence and corrected module map

Read actual pinned `main` [`server.js`](../server.js) (3953 source lines), [`universal-server.js`](../universal-server.js) (3666 lines), [Admin router](../admin-platform/server/router.ts) (607 lines), [Admin entrypoint](../admin-platform/server/index.ts), [Admin config](../admin-platform/server/config.ts), root [`package.json`](../package.json), the relevant `Do not break` invariant section, existing [task 03](CHAT-01-ORIGIN-PR-DEPENDENCIES-20261101.md) on its own Draft branch and current PR file lists.

**Found a factual drift** in the main module map's old *two-server split* section:
- Old text claimed 12 direct gateway paths and listed eight overlapping business routes with stale source line numbers.
- Current main has **ten user-facing method+path overlaps** (separate route handlers; *not proof of semantic parity*): `POST /api/auth`, `GET /api/me`, `PUT /api/me/profile`, `DELETE /api/me/account`, `POST /api/me/consent`, `POST /api/me/beta-tester/claim`, `GET /api/leaderboard/monthly`, `POST /api/staff/activate`, `POST /api/staff/qr/resolve`, `GET /api/admin/users`. Added missing **profile** and **account deletion** from the original list and corrected source line references in the [module map](MODULE-MAP.md).
- `GET /api/health` also exists in both, but the gateway wraps its child health probe with boot/release/account metadata. It is deliberately not counted among the ten *user-action* parity targets.
- Main gateway also directly handles `GET /api/wheel/history` (missed in the map's old list), and `/api/run` cases; these have no Express route by the same path/method.
- Root `package.json:start` launches `node universal-server.js`, which uses `proxyRequest` for other routes; it separately dispatches tenant POS/customer handlers and terminal POS routes ahead of the general fallback. A change in a root Express handler alone is not proof of the deployed endpoint's behavior.

**Second drift:** old map said "Full current baseline 433/433 tests", which cannot be treated as today's passing CI. Recorded it explicitly as a historical test snapshot, with [main required release gate FAILURE](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568138) due to Railway `Not Authorized`, and [VK native parity SUCCESS](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568169). No current all-green conclusion is supported.

## API boundary and security owners (source-level)

| Boundary | Actual main owner / source | Verified source access semantics | Must not infer |
| --- | --- | --- | --- |
| Guest/web app public API | `universal-server.js` request dispatch, `server.js` Express child and named modules `routes/spaceverse-customer.js`, `routes/spaceverse-pos.js` | Gateway identity/terms/platform authorization and a fallback proxy; Express handler uses `authRequired` and roles for many guest routes | That the two implementations are equivalent without HTTP tests, or that Admin session cookies access guest routes |
| Guest PIVNIK admin API | `server.js`, `universal-server.js` for overlapping `GET /api/admin/users`, special POS handlers | Guest bearer/session & role checks; `/api/admin/users` is one of the ten overlapping public paths | That this is the standalone CRM Admin API |
| Independent SPACEVERSE Admin API | `admin-platform/server/index.ts` → `router.ts`, `auth.ts`, `tenant.ts` | `/api/admin/*` namespace, Admin login/session, CSRF and Origin; `resolveVenueScope`, `requireVenueAccess` for `/api/admin/venues/{id}/...`; own static SPA; other `/api/*` rejected | That matching pathname prefixes imply same server or same tenant permissions |
| Admin→guest internal integration | `admin-platform/server/config.ts` `PIVNIK_APP_URL`/`BUSINESS_INTERNAL_TOKEN`, guest `server.js` `requireBusinessService` for `/api/internal/business/*` | Server-only token check in guest root, actor and authorization apply per endpoint | That external business user may call token-protected routes, or that secret values have been verified |
| Cash/POS/bonus | `pos/http.js`, `pos/bonus.js`, gateway `posHttp.device/admin`, Express POS mounts | Distinct terminal authority and authorization; financial write paths must preserve advisory-lock/`FOR UPDATE`, server amount source | That a gateway/CRM refactor may shortcut the ledger or silently repoint a store |
| New tenant CRM diagnostics | `admin-platform/server/tenant-crm-read.ts`, `onboarding-provisioning.ts` and root customer repositories | Default-off, ownership-bound diagnostic; `runtimeStatus:not_provisioned` is not activation | That a prepared tenant/read result equals paid SaaS ready |
| Runtime patch-chain | root `package.json` `prestart`/`materialize`; `scripts/*` | Materialize twice/idempotence and regression needed on final materialized output | That one `apply-*.mjs` can safely be run out of chain or multiple retired simultaneously |

## Other workstreams at current snapshot

- Repo [`main c92ed7cd`](https://github.com/GrafTrahula666/pivnik-bonus-app/commit/c92ed7cd65f1a96d94363c2b7e212424ab078a73); **75 open PRs** at time of GitHub search. No autonomous merge.
- [#339](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/339), CHAT02 auth: `authorization-membership.js`, `authorization-middleware.js`, corresponding tests and checkpoint. The file list does **not** modify either root route file or Admin router. This is a helper carve-out, not proof of mounted authentication fixes.
- [#340](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/340), CHAT04 wizard: `VenueOnboarding.tsx`, CSS, E2E, checkpoint. Does not modify root routes. Need role-gated UI/HTTP parity before acceptance.
- [#343](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/343), CHAT08 dashboard: Cash/ProductionDashboard source, UI tests, checkpoint. This is **not** the root guest `/api/admin/summary` service. Avoid conflating dashboards from two origins.
- [#333](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/333) CHAT10 touches Admin writes and tests, [#335](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/335) CHAT11 changes Railway diagnostics/CI, [#336](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/336) CHAT13 touches `package.json` and marketing consent policy; their changes require integration-specific review. None of those seven inspected PRs currently lists `ops/MODULE-MAP.md`, `server.js`, `universal-server.js` or `admin-platform/server/router.ts` as changed; this is **file list only**, not absence of semantic cross-feature dependencies.
- Conflicting #96/#165 remain independently tracked in [CHAT01-03](CHAT-01-ORIGIN-PR-DEPENDENCIES-20261101.md), which is on a different open Draft branch; do not re-import those multi-domain drafts.

## Gates for any future implementation PR

1. **Authorization:** two independent route-copy handlers if applicable; separately check guest bearer/terms/platform and Admin cookie/Origin/CSRF/company/venue. Negative cases: wrong tenant/venue/customer, missing role, expired session, method mismatch. Account deletion and profile writes explicitly require attention.
2. **Service boundaries:** verify routing host and main deployment SHA, not just that the endpoint path exists. For business routes, require server-to-server token and recipient scope/consent.
3. **Financial paths:** no bypass of POS lock/ledger/idempotency or weakening of staff limits; signed owner proof and license remain external P0 gates.
4. **Tests:** `npm run materialize` ×2 and byte/idempotence diff, `node --test`, `npm run check`, `npm audit` and targeted parity/negative HTTP tests, plus separate Admin TypeScript/browser/mobile checks; current fail-closed release gate must pass **without disabling required verification**.
5. **Deploy:** protect active kiosk signing key/backup, require explicitly authorized rollout and rollback; do not install Draft branch on real device. Synthetic mocks cannot prove live production permissions.

## Completion and next step

- **CHAT01-04:** **DONE as documentation/map correction**, **NOT** release readiness. Files changed on this coordinator branch: `ops/MODULE-MAP.md` and this Markdown checkpoint only.
- **Personally verified:** GitHub source contents and current blob SHA, 10 route overlaps with line numbers, health special case, Admin guest separation, root prestart/start script names, current `Do not break`, relevant concurrent PR file lists and main CI metadata.
- **Not run / not verified:** local checkout, exact runtime route response parity, standalone server tests, root materialize/test/check/audit, Admin build/typecheck, browser/mobile E2E, production feature flags, secrets, target DB, railway config changes, device cert. These are explicit blockers for any merge/deploy of runtime functionality.
- **Next:** CHAT01-05: independent ownership/contract map for the shared file/API surfaces between active CHAT02–CHAT14 PRs, including exact source SHA and endpoint consumers. Only after that define merge ordering in task 06.

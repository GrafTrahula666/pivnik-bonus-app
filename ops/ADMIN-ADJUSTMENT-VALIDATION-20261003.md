# Safe integer validation for manual bonus corrections — 2026-10-03

Fresh base: origin/main `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`.
New clean branch/worktree `fix/admin-adjustment-integer-validation-20261003`
started at exactly this SHA. Current MODULE-MAP.md read; no applicable AGENTS.md
found. Starter pack and SaaS knowledge base were read in the preceding stages.
Existing worktrees and origin branches were inspected, not merged into this one.

## Current inventory / gaps

| Function | Found implementation | Checked in this run | Concrete gap | Next small step |
| --- | --- | --- | --- | --- |
| Cash / Evotor | Draft #174 | Still present in open PR search / origin | Real cash acceptance remains unknown | Authorized sandbox sale/return |
| Business cash dashboard | Draft #176 | Existing implementation retained | Runner fix #181 not incorporated; venue adapter absent | Review runner PR separately |
| CRM / Customer 360 | Main directory; draft #115; origin Customer 360 modules | Main regression suite; draft modules inspected | Authenticated owner browser workflow not verified | One read-only client history |
| Manual bonus corrections | Main server route / persistence; origin `spaceverse/tenant-read-isolation-20260912` executor | Actual route/middleware and proxy tested with fixture providers | Main silently truncates fractions/coerces types and permits unsafe arithmetic | This stage fixes only that boundary |
| Telegram broadcasts | Main campaign store and origin retry branches | Main regression suite passes | Real single test delivery not performed | Preview and authorized test message |
| Achievements / frames | Main catalog/persistence; Business grant/entitlement routes | Main tests pass | Business runtime grant workflow unknown | Verify a single fixture grant |
| Audit / rights | Main transaction journal, authorization; Business tenant modules | Main suite and adjustment HTTP role denials | Global legacy correction route is not a certified multi-tenant mutation | Separate tenant integration review |

Open PRs checked: #174/#176 remain draft alongside #180/#181 and other work.
#180 release gate is successful. #181 release gate and Business workflow are
now successful; on main the Business package is absent, so its workflow reports
that explicitly. Neither previous fix has been merged into this branch.

## Confirmed defect and limited change

`POST /api/admin/users/:id/adjust` used `Math.trunc(Number(...))`: 1.9 became
1 bonus; `true` or `[25]` could become a valid amount. Unsafe values reached
wallet arithmetic. Old/resulting balances were not checked for integer safety.
Baseline-route fixture tests reproduce invalid-amount and unsafe-balance failures.

Main now accepts only nonzero safe integer numbers or signed decimal integer
strings. Fractional/coercible/non-finite/out-of-range inputs receive HTTP 400
before acquiring a wallet DB connection. Existing and resulting balances must
be safe integers; otherwise HTTP 409 follows a rollback, before UPDATE/INSERT.
Negative balances retain the existing HTTP 400 behavior.

The existing origin adjustment executor already contains safe-integer balance
guards; those two narrow guards/messages were reused in the current route.
Its larger orchestration/tenant modules were not copied or rewired. The stricter
HTTP type boundary also prevents boolean/array coercion. No second correction
service, new dependency, environment variable, schema or design was added.

Valid success/replay response shapes, target/wallet locks, request-key lock,
payload conflict handling, unlimited-wallet rule, actor/reason journal and
authorization middleware remain unchanged. UI sends numeric amounts already;
fractional requests now fail instead of silently altering a different amount.

## Two-server parity

Inspected both canonical and materialized server files. Adjustment has no direct
gateway implementation: universal-server forwards it through `proxyRequest`
to server.js, subject to its existing session/consent handling. Gateway source
is unchanged. Tests execute the actual proxy HTTP code with fixture sessions,
proving amount rejection, authorization denials and idempotent responses survive
forwarding. This does not certify all surrounding production gateway middleware.

## Verification

- `npm ci --ignore-scripts`, Node 24.19.0.
- `npm run materialize` twice: identical SHA-256 manifests for tracked files;
  the new guards survive the full chain.
- `node --test`: 444 passed, 0 failed/skipped (base 436 + 8 new tests).
- Eight actual-handler HTTP fixture scenarios: invalid input; signed credit/
  debit and actor/reason journal; 401/403; repeated request/conflicting payload;
  unsafe old/result balance; negative/unlimited wallet; failed journal rollback;
  real gateway proxy forwarding. No production session/DB used.
- `npm run check` and VK startup parity pass.
- Full `npm audit`: 3 existing moderate entries; dependency repair is separate
  draft #180. No package or lockfile change here.
- Public read-only VK/TG probe: 16/16 reachable responses, release main 18a0fa4.
- All generated materialization changes restored; only the canonical correction
  route, its tests and this report are committed.

No merge, production deploy, real-user mutation, production DB change,
migration or broadcast. Routes other than the selected correction are unchanged.
No UI changes, so no new desktop/mobile visual acceptance is claimed.

## Limits / next stage

HTTP tests mock session/profile and database providers. They execute real
middleware/route/proxy code, but do not prove actual PostgreSQL lock contention,
transaction isolation or production session issuance. No authenticated owner
browser or real cash credentials available. Tenant isolation is not introduced
by this legacy single-bar bugfix; broader tenant work remains in its own branch.

Next small stage: verify this correction's replay and rollback against a
disposable test PostgreSQL/PGlite database, before any tenant route rewiring.

# Explicit recovery of failed secondary reads

2026-10-05. Isolated branch `fix/secondary-read-recovery-20261005` starts at
fresh origin/main `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`. Read MODULE-MAP;
no applicable AGENTS found. Worktrees, local changes, origin branches, recent
history, open PRs and CI reviewed. Existing foreign modifications in adjust-status,
adjust-ui, admin-cancel-committed and business-ci-verify remain untouched.
No unmerged feature branch imported. #206 remains a separate profile-notice PR;
its latest release/public/VK parity CI passed. Knowledge Base (30.09.2026) read in
full; starter-pack.md not located after exact and simplified filename searches.
The Knowledge Base contains its summarized starting principles, not its full text.

| Function | Found implementation | Evidence | Concrete gap | Next step |
|---|---|---|---|---|
| Cash/Evotor | Disabled #174, dashboard #176 | #201/#203 isolated return/session fixtures | Production store binding and fiscal samples absent | Controlled onboarding proof |
| CRM/Customer 360 | Main directory, #96/#115 | #196/#197 visibility/ownership diagnostics | Wallet tenant ownership not established by visibility | Approved scoped ownership contract |
| Bonus correction | Main; #193/#199 recovery/replay | Existing SQL and browser fixtures | Full real tenant workflow unverified | Review existing owner entry and tenant binding |
| Telegram | Main broadcast-campaign-store | Existing campaign tests | Provider send/retry scenario not proved here | Isolated provider failure/retry fixture |
| Achievements/frames | Main grants/catalogs | Existing suites | Complete manual scoped grant unverified | Audited grant workflow |
| Rights/audit | Main authorization modules; #195 journal | Existing access tests, #203 signed-session proof | Real multi-tenant isolation unverified | Cross-tenant object tests on approved contract |
| Secondary recovery | Main loadSecondaryData/refreshMe | Original-function and linked-script fixtures | Started flag prevented manual retry after failure | This PR: retry rejected reads only |

## Selected result

After an optional read rejects, the original loader sets bootSecondaryStarted and
never tries it again when refreshMe calls it. Owner/client must reopen to recover.
This stage records rejected loaders, shares an in-flight batch and retries those
loaders after a successful explicit profile refresh. Successful sections retain
loaded data. Existing wheel refresh is included once in that same batch, avoiding
a duplicate when the failed wheel is already queued. Initial staff preload and its
original session-cleanup behavior run once. User message now tells them to refresh.
No timed retry loop, new route, mutation, dependency, service or environment setting.
API GET retry rules and server authorization remain unchanged; failed /api/me blocks
secondary recovery. Explicit retries after a secondary 403 still pass through server
authorization; this does not retry denied requests automatically.

Wallet/contact loaders already catch failures and resolve fallbacks. They are not
queued as rejected jobs. Malformed successful API JSON behavior remains #202; no
claim that this PR detects all invalid secondary payloads. Queue is in-memory and
is rebuilt normally on reopen; no persistence, universal DB editor or writes.

## Validation

Two successful complete materialize runs are byte-identical across 396 tracked
files. An earlier attempt failed on removed wheel anchors; it is not counted as
a successful run. Required compatibility edits preserve old inputs in
apply-v22-product-rebuild and recognize the new loader signature in the existing
VK hydration insertion in apply-working-updates. No individual dependent patch
was run outside the full chain, no patch retired, no generated runtime committed.
The loader source invariant was updated from eagerly invoked jobs to loader
references; its boot-before-background assertions remain intact.

Materialized node --test: 447/447, including 11 original-function recovery tests.
npm run check passes; manual browser verifier syntax and git diff checks pass.
Original linked-script browser fixture: 16 canonical + 16 fully materialized cases,
Telegram/VK at 390/1440 px, empty/success, 403, 503 and closed socket. Failed explicit
retry remains queued; recovery renders a nonempty promotion on the existing screen;
subsequent refresh does not refetch recovered sections. Successful jobs stay loaded;
wheel refresh remains once per settled batch. No page/core-render error or unexpected
fixture write. Application-level fetch counts distinguish bounded GET retry from
Chromium's transparent repeated GET on socket close. Parallel load/refresh and failed
wheel deduplication are verified in original-function tests; no concurrent browser
or database claim. Profile 401/403/503 and invalid confirmed payload reject before
secondary recovery; staff cleanup remains startup-only. Offline failures keep queue
without toast. Wallet's internally resolved fallback is not retried.

Canonical suites before materialization require materialized assets. Their old
failures were compared against an isolated origin/main worktree; the changed
loader-reference invariant is now covered separately. The release result reported
above is the full materialized suite, not a claim that raw canonical suites all pass.

npm audit exits 1: three existing moderate qs/body-parser/express findings, zero
high/critical; no dependency changes. Public read-only probe: 16/16 reachable;
health/shell/assets alone do not prove authenticated production workflows.

## Limits and separate findings

The full-client fixture uses exact renderAppIndex, original linked scripts and local
HTTP responses, warm fixture token and local Telegram/VK SDK adapters. It does not
import either server (avoids startup/production side effects). No real auth, SQL,
tenant, POS, send, staff navigation or production provider proof. VK diagnostics
POST is captured only on loopback; all other API fixture traffic must be GET.

Main's promotions entry is inside an already hidden home-legacy-entrypoints block.
Browser recovery uses the real refresh button and original switchScreen('actions')
to inspect its existing screen renderer. This is evidence of recovered data and
rendering, not a claim that the promotions navigation entry is available. This
separate navigation problem is not changed here. RED COSMOS palette assertion is
an existing console diagnostic, distinguished from page/core-render errors.

No auth/staff/admin/leaderboard server route edits; no server parity change needed.
No patch retirement, destructive migration, production data change, resource,
real message, merge or deploy. Next small stage: investigate the existing hidden
promotions entry and decide its intended navigation, separately from this retry fix.

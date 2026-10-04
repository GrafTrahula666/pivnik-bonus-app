# Existing Evotor return/replay evidence — 2026-10-04

Fresh origin/main: 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
New branch test/evotor-return-replay-evidence-20261004 starts directly from main.
Worktrees/remotes/history/origin branches/open PRs inspected; dirty detached
Business copy preserved. Unchanged MODULE-MAP previously read; no AGENTS found.
Starter pack and knowledge base previously read. No unmerged implementation
imported into this branch or startup. Existing #174 pinned at
776c70d691540b01bbc56a1496203e6cc918eea6 passed release gate 1658, VK parity 576
and public observer 243. Separate admin-platform/production-pilot preserved.

| Function | Existing implementation | Verified | Specific gap | Next small step |
|---|---|---|---|---|
| Cash/Evotor | #174 import/repository/analytics | 40 SQL + 16 local HTTP/browser cases here | Real provider document, signed tenant and concurrency absent | QR link via local HTTP |
| Dashboards | #174 miniapp; #176 Business cash UI | Prior UI evidence; analytics SQL here | Business venue/store adapter missing | Review existing adapter before wiring |
| CRM/Customer 360 | Main directory; #115/#96 | Prior #196/#197 SQL evidence | History is not wallet ownership | Confirm authoritative binding |
| Bonus corrections | Main route; #193/#199 drafts | Prior actual route/proxy/component proofs | Production scoped actor unverified | Complete trusted identity integration |
| Telegram | Main store and retry drafts | Existing regression suite | Live campaign not tested | Isolated provider retry |
| Achievements/frames | Main engine; Business grants | Existing regression suite | Scoped grants unverified | Audited grant scenario |
| Rights/audit | Legacy roles; disabled scope modules | POS pure role boundary here | Real signed tenant authorization absent | Validate approved memberships |

## Selected bounded scenario

No new importer/dashboard implementation. A manual verifier reads ten pinned
source/DDL/fixture files from local git into a disposable directory, prints their
SHA256 hashes and deletes the directory after the run. No automatic fetch/fallback.
Run: node scripts/verify-evotor-return-replay.mjs. Requires the pinned git object
and already-declared PGlite dependency; no new dependencies or configuration.

Actual #174 normalization, page import, customer link, period, SQL read, analytics,
role boundary and sync functions execute on isolated PGlite. Fixture users/QR,
wallets and empty legacy journal are synthetic. Actual migration 012 runs only
inside that disposable in-memory DB. Provider fetch is injected; advisory lock/
unlock are stubbed because PGlite lacks those functions. No production startup,
provider request or tenant ownership claim.

Sixteen cases pass before/after materialization: early refund negative/anonymous;
refund replay; late sale; explicit QR link retrospectively attributes its return;
repeated sale/refund retain totals/link; anonymous same-amount sale excluded from
loyalty; no-base refund excluded; foreign-store base excluded; partial plus remaining
refund nets linked sale to zero; full replay preserves financial document projection;
deleted customer loses attribution but cash remains; invalid page rolls documents/
cursor back; fractional-cent input denied; role denied; conflicting relink denied;
provider outage preserves totals and last successful sync. Full wallet/journal
snapshots stay unchanged after every case. No regression reproduced in this scope.

Upsert may refresh imported_at/sync timestamps even for replay; the proof compares
financial document projection, not byte-identical database rows. Direct SQL role/
function tests do not exercise signed HTTP authentication or the public dispatcher.
No new production feature is delivered: this is evidence for the already-existing,
disabled importer, helping avoid overstated sales and attribution assumptions.

## Metric contract exercised

Source: normalized closed SELL/PAYBACK documents from the pinned fixture format.
Identity: source/store/document ID; repeats upsert one row. All cash sums SELL,
subtracts PAYBACK on its own closed date, and includes anonymous sales. Loyalty
includes explicitly linked sales and returns whose explicit baseDocumentId matches
an eligible linked sale in the same store. Names/phones/amount matching are ignored.

Period: 2026-10-02 Moscow, [2026-10-01T21:00Z, 2026-10-02T21:00Z).
Gross sales/returns/net are integer kopecks. Receipt count sums known sale prints;
returns do not add sale receipts. Average = gross sales / sale receipts, rounded
half-up; it is not net revenue divided by receipts. Active/repeat buyers count sale
participation, so a fully refunded purchaser may remain a buyer. This evidence does
not validate real fiscal print shape, count uniqueness or marketing attribution.

## Verification and limits

Materialize twice: identical SHA256 across 394 tracked/new files present then.
Initial node --test: 427 passed, 9 failed in existing VK client/source assertions.
After materialization recheck, standalone node --test passed 436/436. Cause of the
initial failures not established; no VK changes/fixes claimed. app.js SHA256 equals
previous successful materialized #199 verification. Follow-up failure evidence kept
separate from this POS scenario. npm run check, manual syntax, VK startup parity and
diff-check passed. No patch retirement; generated runtime files restored.

npm audit retains three existing moderate findings (#180). Public read-only probe
16/16 at 2026-10-04T16:09:09+00:00. No production SQL inspection, real receipt sync,
model/API onboarding, signed owner flow, independent PostgreSQL lock/contention or
provider delay proof. UI unchanged, no desktop/mobile UX claim from this stage.
No real data/config/schema/dependency changes, paid resources, merge or deploy.

Next small stage: linked sale and return on different Moscow dates, proving the
return period uses its close date while client attribution can use an out-of-period
base sale. Real provider onboarding remains blocked by verified anonymized receipts
and authorized token/store configuration.

## Cross-period follow-up

Fresh origin/main remains 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5; prior
#201 release gate 1713 passed. No AGENTS found; MODULE-MAP unchanged/read.
Five additional cases execute actual pinned SQL and analytics in a separate
synthetic store: return arrives before its out-of-period sale; sale at
2026-10-02T20:59:59.999Z belongs to October 2 Moscow; return at
2026-10-02T21:00:00.000Z belongs to October 3 Moscow; later explicit QR link
attributes that return even though its base is outside the selected period;
combined interval reconciles both days; repeated import preserves each day's
metrics and financial document projection. (The boundary and attribution
assertions are grouped into five checks.) All 21 checks pass on canonical and
materialized trees; every check preserves synthetic wallets and legacy journal.

October 2: sales/net 1000 kopecks, returns 0, one receipt, average 1000.
October 3: sales 0, returns 300, net -300, no sale receipts, average null,
active buyers 0 and linked revenue share null. Combined October 2–3: net 700,
one active buyer, no repeat buyer. Return identity does not imply a new purchase.

Follow-up validation: 436/436 node tests, npm check and manual syntax passed.
Two materializations produced identical SHA256 for 395 tracked files. The first
hash inventory attempt failed because git quoted non-ASCII filenames; rerun used
NUL-delimited paths and completed successfully. No code regression caused by this
verification helper. npm audit still reports three existing moderate findings.
Production routes and UI unchanged; no desktop/mobile claim. No new regression
reproduced; production readiness, provider fiscal shape, signed tenant authorization
and independent PostgreSQL locking remain unverified as above.

Next bounded evidence stage: unknown fiscal receipt count must keep average null
instead of showing a fabricated zero or dividing by a partial receipt count.

## Missing fiscal receipt evidence follow-up

Fresh origin/main remains 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5;
previous #201 release gate 1714 passed. Remotes, history, origin branches,
open PRs and worktrees rechecked. Foreign dirty gold-orbital image in
admin-cancel-committed and six Business files preserved; not imported.
MODULE-MAP read/unchanged; no applicable AGENTS found. Prior attached knowledge
sources remain the basis; no product implementation restarted.

Five additional checks use the actual pinned importer, repository and analytics:
missing prints preserve 1000 kopecks of sales but receiptCount/averageCents are
null and customer linking returns 409 without a link row; empty prints remain
unknown on replay; mixing that sale with a known 2000-kopeck linked sale keeps
all-cash count/average null, knownReceiptCount=1, while the loyalty cohort has
one known receipt and average 2000; mixed replay preserves financial projection;
later fiscal evidence for the same document yields two receipts and average 1500
without a duplicate sale or inferred customer. Only a subsequent explicit QR link
adds the formerly unknown sale to loyalty (one active, one repeat buyer).

26/26 manual cases pass before and after materialization; all synthetic wallet
and legacy journal snapshots remain unchanged. 436/436 node tests, npm check,
manual syntax and diff-check pass. Two materializations have identical SHA256 for
395 tracked files; generated files restored. npm audit retains three moderate
existing findings. Read-only public probe responds 16/16 on 2026-10-04.

No regression reproduced. Only verifier/report changed: the owner gains evidence
against a misleading average, not an activated production feature. Real fiscal
shape/count uniqueness, signed tenant authorization and concurrent PostgreSQL
remain unverified. UI unchanged; desktop/mobile scenario not claimed.

Next small scenario: split fiscal sales contribute their known print count but
must not be attributed to one customer; explicit link must be refused. Real
provider onboarding still requires verified anonymized documents and authorized
configuration. No merge, deploy, real DB/data/config change or new dependencies.

## Split fiscal sale follow-up

Fresh origin/main remains 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5;
previous #201 release gate 1715 passed. Origin branches/open PRs/history/remotes
and worktrees checked again; foreign dirty frame image and six Business files
preserved. MODULE-MAP read/unchanged, no AGENTS found; previously read starter
and knowledge base retained. Existing #174 implementation is still pinned,
not copied into production or startup.

Five new isolated checks execute actual normalization/import/customer-link/SQL/
analytics functions: one 1000-kopeck sale with two fiscal print records gives
one sale document, two receipts and average 500, while QR linking returns 409
without inserting a customer link; its 300-kopeck return gives cash net 700,
retains sale average 500 and never inherits a customer from the split base;
one print with two print groups likewise refuses linking; page replay and
repeated refusal preserve financial document projection, links and metrics;
a previously linked one-print sale later updated to two prints disappears
from loyalty while its recorded confirming actor/time/link remain intact.
Combined synthetic sales: gross 4000, returns 300, net 3700, five sale receipts,
average 800. No wallet or legacy journal changes after any check.

31/31 manual cases pass on canonical/materialized trees; 436/436 node tests,
npm check, manual syntax and diff-check pass. Two materializations have identical
SHA256 for 395 tracked files. npm audit retains three existing moderate findings.
Public read-only probe initially 8/16: all VK requests timed out; one retry
passed 16/16. This does not prove the cause or absence of intermittent VK issues.

Verification completed 2026-10-04T19:01:38.879355+00:00.

No regression reproduced; only verifier/report changed. Evidence protects the
owner from attributing an entire split sale to a single customer; no new panel
feature activated. Fiscal print uniqueness and actual provider format still
need verified anonymized real documents. Signed production tenant authorization
and independent PostgreSQL concurrency remain unverified. UI/routes untouched,
no desktop/mobile claim, no patch retirement, merge, deploy, real DB/data/config
change or new dependency.

Next small stage: existing connection-state contract (not connected, schema
required, awaiting sync, syncing, connected, error) so missing setup cannot be
presented as confirmed zero sales. Keep provider onboarding blockers explicit.

## Connection-state follow-up

Fresh origin/main remains 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5;
previous #201 release gate 1716 passed. History/remotes/origin branches/open PRs
and worktrees inspected; foreign dirty gold frame and six Business files preserved.
MODULE-MAP read/unchanged; no applicable AGENTS found. Prior starter/knowledge
base context retained. No unmerged implementation imported into branch/startup.

Nine additional checks execute actual pinned createPosService.dashboard and
posConnectionStatus with SQL in disposable PGlite: missing enable/token/store
returns not_connected plus null metrics; a separate empty DB returns
schema_required without applying any migration; configured/no sync returns
awaiting_sync plus null metrics; first partial scan returns syncing/incomplete
with null metrics; completed import exposes 1000-kopeck confirmed cash metrics,
lastSuccessAt and complete history; later partial scan retains those metrics but
marks history incomplete; token_expired error retains previous data and freshness
and repeated dashboard reads leave documents/sync state unchanged; 401/403 and
invalid calendar date 400 occur before dashboard SQL; status DB failure propagates
instead of producing a successful zero-sales result. Manual app-journal metrics
remain explicitly labelled as unconfirmed staff records.

40/40 diagnostic cases pass before/after materialization. 436/436 node tests,
npm check, manual syntax and diff-check pass. Two materializations identical
SHA256 across 395 tracked files. npm audit: same three moderate findings.
Public read-only probe: 16/16. Verification completed 2026-10-04T20:05:16.912590+00:00.

No regression reproduced. Only diagnostic/report changed, no new working panel
function enabled. Missing setup cannot be confused with confirmed zero sales at
service level on this fixture. Actual pos-admin.js visual states exist in #174;
they were located but not browser-verified here. Real provider/fiscal schema,
signed tenant authorization, production entry and concurrent PostgreSQL remain
unverified. No production SQL/data/config/schema changes, deps, merge, deploy,
route/UI change or patch retirement.

Next small stage: verify the existing pos-admin.js state labels, unavailable
metrics and cached-data freshness on desktop/mobile using isolated responses.

## Existing POS UI follow-up

Fresh main remains 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5; previous #201
release gate 1717 passed. Clean own starting worktree, history/remotes/origin refs
and worktrees checked; foreign dirty frame image/six Business files preserved.
MODULE-MAP read/unchanged, no applicable AGENTS found. Previously read attached
knowledge sources retained; implementations listed above not restarted/imported.

New manual scripts/verify-evotor-status-ui.mjs reads exact pinned pos-admin.js and
pos-admin.css into a real headless browser, records their SHA256 hashes and runs
38 scenarios across 390/1440 px and both loyalty/all-cash tabs. External existing
Playwright module and Chromium are explicit CLI arguments; no install, dependency,
environment variable or automatic fallback. Minimal active admin container uses
actual module/CSS, a synthetic viewer role and controlled API promise/responses.
It does not launch the app, authenticate, contact a provider or write real data.

Checks: initial pending loading label; all six connection labels; absent metrics
show unavailable text and no zero-valued cards; cached sync/error data show amount
and >10-minute freshness warning; token error explanation; connected empty period
has legitimate zero metrics; both tabs preserve state; manual staff journal stays
labelled unconfirmed; viewer sync control hidden; permission/network refusal clears
previous metrics and displays error; no page overflow or uncaught browser error.
40 SQL/import/service cases and 38 browser scenarios pass before/after
materialization. 436/436 node tests, npm check, manual syntax and diff-check pass.
Two materializations identical SHA256 across 396 tracked/new files. npm audit:
three existing moderate findings. Public read-only probe: 16/16.

Verification completed 2026-10-04T21:03:37.823984+00:00.

No UI regression reproduced. Only manual verifier/report added; actual production
UI/module/style unchanged. This proves fixture-state presentation, not full app
boot, signed owner entry, keyboard/screen-reader usability, owner write controls
or real receipt loading. Service/UI are checked separately, not a single signed
HTTP end-to-end scenario. Prior provider/fiscal/concurrent PostgreSQL limitations
remain. No production data/schema/config, merge, deploy or patch retirement.

Next small stage: existing owner sync control, pending/double-click protection and
provider refusal on the isolated UI fixture, without real provider requests.

## Owner sync control follow-up

Verified main remains 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5; previous
#201 release gate 1718 passed. Origin fetch, history/refs/remotes, open PRs and
worktrees checked. Foreign dirty work in adjust-status/admin-cancel-committed and
six Business files preserved. MODULE-MAP read, no applicable AGENTS found; prior
starter/knowledge sources retained. No foreign implementation copied into branch.

Browser diagnostic now switches its synthetic viewer to admin and executes the
actual pinned module click handlers at 390/1440 px. Eight additional scenarios per
width: owner sync control visible; complete response; partial response next-page
hint; busy response without false next-page/completion hint; provider refusal;
permission refusal; network refusal; accepted sync followed by dashboard refresh
failure. Each sync scenario checks one POST despite a second native click while
disabled, timeoutMs=20000/retries=0 request options and button re-enabled after
settlement. Refusals retain already-visible fixture metrics and display their
error; refresh failure clears metrics and displays failure without success claim.

54 browser cases pass before/after materialization, plus 40 isolated SQL cases.
436/436 node tests, npm check, syntax and diff-check pass; two materializations
identical SHA256 for 396 tracked files. npm audit retains three moderate findings.
Public read-only probe initially 8/16 (Telegram timeouts); one retry 16/16.
Cause unestablished; local fixture checks do not prove production availability.
Verification completed 2026-10-04T21:59:13.000859+00:00.

No regression reproduced. Only verifier/report updated; production panel unchanged.
Second-click proof covers native disabled controls in one browser document only;
it does not prove cross-tab/concurrent PostgreSQL locks or server idempotency.
API promises/responses are synthetic and server/SQL evidence remains separately
exercised. Busy fixture checks no extra next-page hint, not real provider progress.
Real provider loading, signed production owner entry and full app boot remain
unverified. No provider requests, production data/config/schema writes, dependency,
merge, deploy, route/UI change or patch retirement.

Next bounded stage: compose the existing POS service and owner click handler
through a local HTTP fixture with controlled provider responses, so the UI result
is tied to actual import/status SQL rather than independently invented responses.


## Local HTTP composition follow-up

Fresh origin/main remains 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Previous #201 commit 1041932 release gate 1719 passed. Open PRs, remotes,
worktrees, history and pinned foreign branches checked; foreign dirty images and
six Business files preserved. MODULE-MAP remains unchanged; no AGENTS found.

Added manual scripts/verify-evotor-http-ui.mjs. It reads twelve exact pinned
source files, emits SHA256 hashes, executes them in disposable temporary modules
and removes them afterwards. It serves the original POS JS/CSS over loopback HTTP.
The actual createPosService dashboard/sync, Evotor client response decoding,
normalizer, import transactions, status SQL and analytics produce the browser
response. Only provider URLs for the exact fixture store are redirected to a
controlled local HTTP provider; no real provider calls or credentials. Fixture
sale closes at run time, using the real Moscow today period. Native fetch wrapper
and minimal HTML/session/API transport are diagnostic adapters, not production
app.js/gateway authentication or retry/timeout implementations.

16 composition cases pass, eight each at 390 and 1440 px: initial awaiting state
without invented zero; owner click through provider/import/SQL displays 10 rubles;
anonymous sale remains zero in loyalty; repeated sync retains one document and
1000 kopecks; provider HTTP 401 retains cash and stores token_expired, with refresh
showing the actual error state; viewer POST returns 403 before provider access;
unauthenticated GET returns 401 and impossible calendar date returns 400;
disabled connection hides cached metrics. Pending native second click sends one
POST. Wallet snapshot and empty journal remain unchanged; no page JavaScript
errors or viewport overflow. Each width gets a fresh in-memory DB.

No product regression reproduced. The initial harness lacked an HTML content type
and then an explicit UTF-8 charset; those diagnostic setup failures were corrected
before the successful run. They are not production regressions. Actual migration
012 runs only in disposable PGlite. Advisory lock/unlock are stubbed; synthetic
legacy admin/viewer actor is not proof of signed owner or SaaS tenant isolation.

Validation: canonical and materialized composition 16/16; existing isolated SQL
40/40 and browser fixture 54/54; node --test 436/436; npm run check, explicit
script syntax and git diff --check pass. Two materializations have identical
SHA256 for 397 tracked/new files. npm audit still reports three moderate existing
findings. Public read-only probe 16/16. Generated runtime files restored before
commit. No production code, UI, routes, data, schema or configuration changed;
no dependency, deployment, merge, sends or patch retirement.

Owner benefit is verified separation of imported cash and anonymous loyalty totals
in the existing draft, not a newly enabled production feature. Real provider
format/configuration, signed full startup, independent PostgreSQL concurrency,
keyboard/screen-reader use and premium-dark full shell remain unverified.
Next bounded stage: original QR confirmation handler plus actual service.link via
local HTTP, covering explicit identity, repeated link, conflict and role denial.

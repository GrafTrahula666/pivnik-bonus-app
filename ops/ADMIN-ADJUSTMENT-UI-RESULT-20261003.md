# Owner bonus adjustment: confirmed result and reload recovery — 2026-10-03

Base: fetched origin/main 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Branch derives from that verified main; existing own draft #193 is extended as
one related correction scenario. Fresh remotes/history/origin branches/open PRs
inspected. Other worktrees preserved: detached business-ci-verify has generated
runtime modifications; other worktrees were clean. Starter pack, knowledge base
and ops/MODULE-MAP previously read; no applicable AGENTS.md found. No foreign
unmerged production implementation included. #182/#184 server fixes remain
separate drafts. No patch retirement or standalone dependent script execution.

## Selected stage and resulting behavior

Confirmed problems: a saved adjustment was masked by a directory refresh error;
another click after an unknown POST outcome generated a new request key. Earlier
same-page recovery lost its command when the owner reloaded the page.

The Balance control validates a nonzero safe integer and reason, disables
pending clicks and requires {ok:true,balance:nonnegativeSafeInteger} from the
server. Directory refresh failure is reported separately from a confirmed save.
No local wallet arithmetic or arbitrary database field editing.

Before POST, write and read back a versioned sessionStorage record containing
only scope, amount, reason and requestKey. Scope includes platform, authenticated
actor and client. No auth token is stored. Each record is limited to 8192
characters; storage quota/write/read failures prevent a new POST. Corrupt,
unsupported or mismatched records block replacement rather than silently
inventing another key. Records are not automatically expired or evicted.

The same-tab reload restores the pending command and renders Retry. An explicit
confirmation shows its amount, client and reason; retry sends the same command
with retries=0. A later denial after uncertainty retains it. A first non-retried
4xx clears a definite rejection. Success clears the record; if deletion fails,
the current page still recognizes confirmed success and a later reload can only
replay the same server-checked key. Rendering replacement buttons shares the
in-flight guard. Clearing uses the original captured scope, not a later actor.

The owner can now reload the same tab after losing an adjustment reply and
explicitly recover its result without generating another financial command.
This is a browser recovery improvement, not tenant isolation or a new ledger.

## Inventory

| Function | Found implementation | Verification | Concrete gap | Next step |
|---|---|---|---|---|
| Cash/Evotor | Draft #174, two dashboards | Existing branch/PR evidence | Real receipt sync unavailable | Verify returns/dedup reconciliation |
| Dashboard/CRM | Main directory/summary; Business #176 | Regression suite; actual CRM modal fixtures | Business adapter is draft | Read flow after integration |
| Customer 360 | #115, tenant #96 | Existing branch evidence | Not integrated/enabled | Review scoped reads |
| Bonus correction | Main route/store; #182–184; UI #193 | 13 function + 4 HTTP/SQL tests; 48 browser fixtures + 16 joint browser/SQL cases | Closing tab/multi-tab coordination not covered | Review pending-operation history resolution |
| Cancellation | #185–189, joint verifier #191 | Prior SQL/HTTP/browser proofs | Drafts unmerged | Review existing stages |
| Telegram | Main broadcast store/retry drafts | Existing regression suite | Real provider delivery unverified | Provider fixture retry |
| Achievements/frames | Main engine/personal frames, Business grants | Existing regression suite | Tenant grant flow unverified | Audited grant scenario |
| Rights/audit | Main roles/journal; #96 | Viewer controls; actual middleware with session fixture | Production tenant isolation not proven | Scoped cross-tenant checks |

## Verification

- 13 function tests: saved/read separation; credit/debit/replay; invalid inputs;
  401/403/400/409/500 and malformed success; repeated pending clicks and replaced
  DOM controls; uncertain retry/later denial; fresh-page storage recovery;
  unavailable/quota/non-writing/corrupt/oversize storage prevents POST;
  actor/client/platform separation; deletion failure replays old key safely;
  declining recovery confirmation retains the original command.
- 4 UI + actual HTTP + SQL tests using main route/auth/role/replay/persistence
  and real legacy schema/startup upgrades in isolated PGlite. Client adapter
  loses the response after actual COMMIT. Recreate UI map with shared tab storage,
  then retry credit/debit with/without an intervening actual staff 403. Wallets
  remain 125/75, journal count remains one, actor/reason/key remain unchanged.
  Sixteen semantic conflicts (amount, actor, client, reason) return 409 and
  preserve full wallet/journal snapshots. SQL connections are released.
- Full materialized node --test: 453/453. Double materialize with identical
  tracked SHA-256; complete chain preserves helper/storage/button wiring.
  npm run check, VK parity, canonical focused tests and diff-check pass.
- npm audit: existing 3 moderate; separate draft #180. No dependency changes.
- Browser: actual CRM modal render/click/prompt on existing HTML/CSS, VK/TG x
  390/1440px, 12 scenarios each (48). Includes actual page.reload(), restored
  Retry button, identical command body and zero regenerated keys. Prior success,
  denial, malformed/unknown outcome, pending rerender and viewer cases retained.
  Mobile/desktop screenshots inspected; no horizontal list overflow. CSS/theme
  unchanged. API/session/refresh boundaries are fixtures.

Manual reproduction requires caller-provided Playwright and Chromium:
`node scripts/admin-adjustment-ui-browser-smoke.mjs /path/to/chromium`.
No browser dependency added to the project; script is not auto-discovered by
node --test. Generated runtime diffs are restored before the commit.

## Runtime and limits

Read-only Railway probe during this verification: 16/16, deployed main 18a0fa4.
#193 prior head bd50ba9 passed release gate 1688 and VK parity 596. Public
observation 256 failed; the Selectel gateway/real VK launch remains unverified.
No authenticated production sessions or gateway server logs are available.

SQL is sequential isolated PGlite, not independent PostgreSQL concurrency.
Identity/session/profile validation boundaries are fixtures. No claim of server
tenant isolation. The four automatic SQL tests inject adapter loss after SQL/HTTP succeeds. The
new joint manual verifier closes a real browser HTTP response after headers and
a partial JSON body, after the actual proxy has consumed a committed SQL reply.
The full signed production app bootstrap is still outside this isolated test.

sessionStorage covers reload of the same tab while its storage remains intact.
Closing the tab, clearing storage, separate tabs/origins and session handoff are
not a durable recovery guarantee. Browser recovery never resends automatically.
A permanent denial or corrupt command can require history/support resolution;
no speculative key replacement or manual arbitrary storage editor is provided.
A replay balance can be older than the latest wallet, so directory refresh is
still necessary. Records store the operation reason until confirmation/tab end.

No production writes, migrations, env/services/dependencies, mass messages,
merge or deploy. Next small stage: review a bounded history-based resolution flow for a pending
correction that remains denied after recovery; preserve server scope and original keys.


## Joint client API / gateway / SQL / reload verification

Added scripts/verify-admin-adjustment-recovery.mjs. Reuses the existing isolated
SQL test harness (without importing/registering its tests), exposes its local
base URL, and extracts the actual universal-server.js proxyRequest plus client
api()/fetchWithTimeout and current CRM/recovery handlers. No full application
startup, archived patch scripts, production services or foreign draft code run.

Eight cases: VK/TG x 390/1440px x +25/-25. The real gateway proxy consumes an
HTTP 200 committed reply; a Writable transport fixture sends its headers and a
partial JSON body, then destroys the browser socket. Native browser fetch sees
an unreadable result. There is one initial POST; manual reload restores Retry.
A stale owner UI with a staff token receives server role denial and keeps its
original command; restoring the authorized fixture token confirms its replay.
All three command bodies match, with platform headers forwarded. No new key is
generated after reload. Wallets remain 125/75 and journal entries stay at one,
with complete snapshots unchanged. Directory read outage is separated from the
saved financial result. Forty further API checks (401, 403, amount zero 400,
semantic conflict 409, pre-upstream 502) preserve the same SQL snapshots.

The first experimental full-socket close before any response bytes was retried
transparently by this Chromium build, despite api retries=0; it received the
same-key replay success. The verifier therefore sends headers/partial JSON to
produce a deterministic unknown result. Browser-internal retry behavior is not
controlled by the app's retry loop; do not claim exactly one network attempt
for every browser. Server semantic idempotency remains essential.

Run with caller-provided Playwright and Chromium:
`node scripts/verify-admin-adjustment-recovery.mjs /path/to/chromium`.
The manual verifier ran on canonical and materialized sources; all 8 cases and
40 denial/error checks passed. Screenshots of the restored Retry control were
inspected on mobile/desktop. Existing full regression remains 453/453; check,
manual-script syntax, double materialize hash equality and VK parity passed.
Audit retains the same three moderate findings. No product code changed in this
follow-up; only the verifier, test fixture URL and report. Session/identity/token
canonicalization and directory refresh are fixture boundaries; SQL is sequential
PGlite. Gateway means the actual universal-server proxy on local HTTP, not the
unavailable Selectel TLS/Caddy edge or signed VK/TG entry.


## Journal write rollback through browser / gateway / SQL — 2026-10-04

Fresh fetch still reports main 18a0fa4. Current open drafts and other worktrees
were checked again; no foreign work was incorporated. This follow-up changes
only the joint manual verifier and this report, not application/runtime code.

The verifier now runs sixteen cases: VK/TG x 390/1440px x +25/-25 x two
fault types. The eight added cases install a CHECK constraint only in the
isolated in-memory SQL fixture. Wallet UPDATE executes, journal INSERT violates
the constraint, and the actual route returns HTTP 500 through the actual local
gateway and browser api. Both wallets and the entire selected journal snapshot
match the pre-request baseline (100 bonus balance, no journal entries).

After removing the isolated fault, a real page reload restores the original
command. An intervening staff 403 changes neither wallet nor journal and keeps
Retry available. Authorized recovery then commits exactly one journal entry
with the original key, owner ID and reason and yields 125/75. All three browser
POST bodies match. No new key is generated after reload; confirmed success
clears tab storage and stays separate from a failing directory refresh. The
other eight socket-loss cases still prove replay of the already committed entry.

Canonical and double-materialized sources each passed all 16 scenarios and 80
further API denial/invalid/conflict/external-error checks. All SQL connections
were released; mobile/desktop reload screenshots inspected and list overflow
assertions passed. Full materialized node --test: 453/453; check, VK parity,
script syntax, canonical focused tests and diff-check passed. Both materialize
runs had identical hashes for every tracked file. npm audit still reports the
same 3 moderate findings (separate #180); dependencies were unchanged. Fresh
read-only runtime probe: 16/16, deployed commit remains 18a0fa4.

Limits remain: sequential isolated PGlite, fixture session identity and gateway
token canonicalization; no production financial operation, concurrent PostgreSQL
proof, tenant isolation proof or signed VK/TG launch. Existing light service
theme was inspected as-is; the requested dark redesign is not completed by this
verification. No production data or schema changed, and no merge/deploy occurred.

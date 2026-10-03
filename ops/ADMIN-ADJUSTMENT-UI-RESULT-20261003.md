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
| Bonus correction | Main route/store; #182–184; UI #193 | 13 function + 4 HTTP/SQL tests; 48 browser cases | Closing tab/multi-tab coordination not covered | Review request transport and recovery together |
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
#193 prior head 7de14a5 passed release gate 1686 and VK parity 594. Public
observation 254 failed; the Selectel gateway/real VK launch remains unverified.
No authenticated production sessions or gateway server logs are available.

SQL is sequential isolated PGlite, not independent PostgreSQL concurrency.
Identity/session/profile validation boundaries are fixtures. No claim of server
tenant isolation. Transport loss is injected after server SQL/HTTP succeeds;
it is not a real network socket failure in the full production app bootstrap.

sessionStorage covers reload of the same tab while its storage remains intact.
Closing the tab, clearing storage, separate tabs/origins and session handoff are
not a durable recovery guarantee. Browser recovery never resends automatically.
A permanent denial or corrupt command can require history/support resolution;
no speculative key replacement or manual arbitrary storage editor is provided.
A replay balance can be older than the latest wallet, so directory refresh is
still necessary. Records store the operation reason until confirmation/tab end.

No production writes, migrations, env/services/dependencies, mass messages,
merge or deploy. Next small stage: verify reload recovery through actual client
api() and gateway with controlled transport failures on an isolated SQL fixture.

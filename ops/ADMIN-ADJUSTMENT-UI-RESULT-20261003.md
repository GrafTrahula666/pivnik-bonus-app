# Owner bonus adjustment: confirmed save vs refresh failure — 2026-10-03

Base: fetched origin/main 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Existing clean worktrees/history/remotes and origin adjustment/CRM/Customer 360
branches were inspected and preserved. Starter pack, knowledge base and
ops/MODULE-MAP previously read; no applicable AGENTS.md found. No draft copied.
Latest #192 release gate 1683 passed; public observation still fails.

## Selected stage

Confirmed problems: a saved adjustment could be masked by a directory read
failure; after an uncertain POST result, another click generated a new request
key and could apply the same adjustment twice.

Separate confirmed POST success from directory refresh. Validate a nonzero safe
integer; require ok=true and a nonnegative safe integer response balance. Keep
an in-memory command per authenticated owner/client until confirmed: amount,
reason, requestKey and in-flight status. The same-page Retry control confirms
and reuses that exact command; it does not prompt for a new amount or key.
Rerendered controls share the pending guard and become available when the
request settles. A first non-retried 4xx clears a definite rejection; 5xx,
transport failure or malformed success retains uncertainty. After an uncertain
request, a later denial also retains the original command.

This selected UI explicitly sets retries=0; recovery is an owner-confirmed
manual retry using the existing server's semantic idempotency checks. The
shared api() behavior for all other operations is unchanged. No local wallet
arithmetic or arbitrary field editing. No persistent browser storage added.

The owner can distinguish a saved correction from a read outage and retry an
uncertain result safely within the same open page. Server input hardening #182
and connection handling #184 remain separate unmerged drafts. Current server
response contract {ok:true,balance,replayed?} is preserved. No CSS changes.

## Inventory

| Function | Found implementation | Verification | Concrete gap | Next step |
|---|---|---|---|---|
| Cash/Evotor | Draft #174, two dashboards | Existing branch/PR evidence | Real receipt synchronization unavailable | Verify return/dedup reconciliation |
| Dashboard/CRM | Main directory/summary; Business #176 | Regression suite; CRM modal fixture here | Business adapter is draft | Verify read flow after integration |
| Customer 360 | #115, tenant #96 | Existing evidence | Not integrated/enabled | Review scoped reads |
| Bonus correction | Main route/store; #182–184 | 8 UI tests + 1 HTTP/SQL test + 40 browser cases | Reload/multiple-tab recovery unavailable | Recover pending key across reload safely |
| Cancellation | #185–189, joint verifier #191 | Prior SQL/HTTP/browser proofs | Drafts unmerged | Review existing stages |
| Telegram | Main broadcast store/retry drafts | Existing regression suite only | Real provider delivery unverified | Provider fixture retry |
| Achievements/frames | Main engine/personal frames, Business grants | Existing regression suite only | Tenant grant flow unverified | Audited grant scenario |
| Rights/audit | Main roles/journal; #96 | Viewer UI hidden; 401/403 fixtures | Production tenant isolation not proven | Scoped cross-tenant tests |

## Verification

- 8 function tests: credit/debit/replay and refresh failure; invalid/cancelled
  input; 401/403/400/409/500 and malformed success; pending repeated click;
  lost result retry with identical semantic body/key; replacement button guard;
  later denial retains the uncertain command.
- 1 combined UI + actual HTTP + SQL test: actual main adjustment route, auth/role
  middleware, replay helpers and persistence on isolated PGlite. Transport
  adapter drops the response after HTTP confirms COMMIT; UI retries manually.
  Wallet stays 125, journal count stays one, original actor/reason/key preserved,
  requestId called once. Harness reuses our prior #183 fixture construction,
  not any unmerged production route changes. Session/profile boundaries mocked.
- Materialize twice; all tracked SHA-256 equal. Helper/map/click binding survive
  the complete chain. No standalone dependent patch.
- Full materialized node --test: 445/445; check, VK parity and diff-check pass.
- npm audit: existing 3 moderate; separate #180. Dependencies unchanged.
- Manual browser: actual CRM modal render/click/prompt on existing HTML/CSS,
  VK/TG x 390/1440px, 10 cases each (40 total). Includes uncertain 500/lost reply
  followed by original-command recovery, directory rerender while pending,
  viewer controls and no horizontal list overflow. API/session/refresh are
  fixtures. Mobile/desktop screenshots inspected; existing toast styles.
- Generated changes restored; focused tests pass again on canonical source.

Manual reproduction (requires caller-provided Playwright and Chromium):
`node scripts/admin-adjustment-ui-browser-smoke.mjs /path/to/chromium`.
Playwright is not a project dependency and this script is not auto-discovered
by node --test. It writes temporary artifacts locally.

## Runtime / boundaries

Read-only Railway probe at 2026-10-03T17:11:44Z: 16/16, deployed main 18a0fa4.
This does not validate the Selectel hop: #193 deployed-endpoint CI observation
failed, while release gate 1684 and VK parity 592 passed on its prior head.
No gateway server logs/authenticated production UI available.

Browser API/profile/refresh are fixtures; no claim of production signed launch
or server tenant isolation. SQL is sequential isolated PGlite, not independent
PostgreSQL concurrency. Same-page recovery is verified; reload/closing the page
loses the in-memory command, other tabs are independent. UI explicitly warns
not to reload an uncertain operation. No automatic command expiry/discard.
Unknown outcomes with later permanent denial can therefore require separate
history/support resolution; do not replace the key speculatively. An operation's
replay balance can be older than the latest wallet; refresh remains necessary.
No production writes/env/dependencies/migrations, merge or deploy.

Next small stage: safe pending-key recovery across reload, scoped to the actor
and client, with bounded storage, explicit recovery UI and SQL/browser proof.

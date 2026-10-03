# Owner bonus adjustment: confirmed save vs refresh failure — 2026-10-03

Base: fetched origin/main 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Existing clean worktrees/history/remotes and origin adjustment/CRM/Customer 360
branches were inspected and preserved. Starter pack, knowledge base and
ops/MODULE-MAP previously read; no applicable AGENTS.md found. No draft copied.
Latest #192 release gate 1683 passed; public observation still fails.

## Selected stage

Confirmed main bug: Balance POST succeeds, then refreshAdminUsersDirectory
rejects; the shared catch overwrites the saved result with a read error.
Separate the saved adjustment result from the subsequent directory refresh.
Validate a nonzero safe integer before POST, disable this button while pending,
keep one request key in the existing API retry, and require ok=true plus a
nonnegative safe integer balance from the response. A failed refresh explicitly
says the adjustment was saved and the list needs refreshing before a new one.
No local wallet arithmetic or arbitrary field editing is introduced.

The owner can now distinguish saved bonus correction from a directory read
outage. This is a UI stage only; server input hardening #182 and connection
handling #184 remain separate unmerged drafts. Current server response contract
{ok:true,balance,replayed?} is preserved. No CSS/theme changes.

## Inventory

| Function | Found implementation | Verification | Concrete gap | Next step |
|---|---|---|---|---|
| Cash/Evotor | Draft #174, two dashboards | Existing branch/PR evidence | Real receipt synchronization unavailable | Verify return/dedup reconciliation |
| Dashboard/CRM | Main directory/summary; Business #176 | Regression suite; CRM modal fixture here | Business adapter is draft | Verify read flow after integration |
| Customer 360 | #115, tenant #96 | Existing evidence | Not integrated/enabled | Review scoped reads |
| Bonus correction | Main route/store; #182–184 | 5 new UI tests + 32 browser cases | Lost POST reply across a new user action | Preserve/recover uncertain request key |
| Cancellation | #185–189, joint verifier #191 | Prior SQL/HTTP/browser proofs | Drafts unmerged | Review existing stages |
| Telegram | Main broadcast store/retry drafts | Existing regression suite only | Real provider delivery unverified | Provider fixture retry |
| Achievements/frames | Main engine/personal frames, Business grants | Existing regression suite only | Tenant grant flow unverified | Audited grant scenario |
| Rights/audit | Main roles/journal; #96 | Viewer UI hidden; 401/403 fixtures | Production tenant isolation not proven | Scoped cross-tenant tests |

## Verification

- 5 new function tests: confirmed success/credit/debit/replay, refresh failure,
  invalid amount/cancelled input/empty reason, 401/403/400/409/500, malformed
  success response and repeated pending click (one POST).
- `npm run materialize` twice; all tracked SHA-256 hashes identical. Helper
  and click binding survive the complete chain. No standalone dependent patch.
- Full materialized `node --test`: 441/441; check and VK startup parity pass.
- npm audit: existing 3 moderate findings; #180 handles these separately.
- Manual browser verifier executes actual renderUsers, adjustment helper/click
  binding and CRM activity markup on existing HTML/CSS with fixture API/refresh:
  VK/TG x 390/1440px, 8 cases each (32 total). Modal click/prompt, success,
  refresh failure, denial, server error, replay, invalid amount, pending repeat
  and viewer controls checked; list has no horizontal overflow. Screenshots
  inspected at mobile/desktop; toast overlays are existing styles.
- Generated runtime changes restored; focused 5 tests pass again on canonical.
- `git diff --check` passes. No server routes changed; parity gate still run.

Manual reproduction (requires caller-provided Playwright and Chromium):
`node scripts/admin-adjustment-ui-browser-smoke.mjs /path/to/chromium`.
Playwright is not a project dependency and this script is not auto-discovered
by node --test. It writes temporary artifacts locally.

## Runtime / boundaries

Public runtime evidence remains #192 report: gateway TCP/TLS times out from
GitHub runner; Railway and Vercel relay health pass. This stage does not retry
infrastructure changes, signed launches, real SQL mutations or messages.
Browser API/profile/refresh are fixtures: no claim of signed-in production
workflow or server tenant isolation. Local tests do not model directory rerender
while POST is pending, multiple browser tabs or persistent idempotency recovery
after an unknown network result. A replay balance is the saved operation's
balance, not necessarily today's latest balance; failed refresh copy says
"balance after operation" accordingly. Current server safety still requires
reviewing #182/#184. No production data/env/dependencies, migrations, merge/deploy.

Next small stage: pending request-key recovery for an uncertain adjustment
response, with semantic command matching and an isolated SQL/browser proof.

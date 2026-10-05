# Background profile refresh failure notice

2026-10-05. Branch `fix/profile-hydration-failure-notice-20261005` starts exactly
from freshly fetched origin/main `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`.
MODULE-MAP read; no AGENTS present. Remotes, worktrees, history, origin branches,
open PRs and CI reviewed. Prior #203 head 7c6c682 passed release gate 1744.
Existing starter-pack/knowledge-base context retained. Foreign work preserved;
no unmerged implementation imported, including #198/#202/#203/#204/#205.

| Function | Existing implementation | Verification | Gap | Next step |
|---|---|---|---|---|
| Cash/Evotor | Disabled #174, dashboard #176 | #201/#203 isolated SQL/transport evidence | Fiscal samples/store binding missing | Controlled onboarding |
| CRM/Customer 360 | Main plus #96/#115 | #196/#197 scope evidence | Visibility does not establish wallet ownership | Approved ownership contract |
| Bonus corrections | Main plus #193/#199 | SQL/replay/recovery tests | Complete tenant workflow unproven | Existing scope/entry review |
| Telegram | Main campaign store | Existing suite | Live retry behavior unverified | Isolated provider failure |
| Achievements/frames | Main and Business grants | Existing suite | Scoped manual grant not fully proved | Audited grant scenario |
| Rights/audit | Gateway plus #174 draft | #203 signed-session evidence | Tenant isolation unproven | Store/tenant binding review |
| Profile refresh UX | Main boot/hydration/manual refresh | #203 found retained DOM without toast | Background failure was silent | This bounded fix |

## Caller review and selected fix

Initial boot errors call showBootActions. On successful boot, finishBoot hides the
boot overlay, then schedulePostBootHydration starts hydrateAfterBoot asynchronously.
That function previously only logged failures. The window error handler shows boot
actions only while the overlay is visible; unhandledrejection only logs, and this
failure is caught anyway. visibilitychange refreshes the bridge, not the profile.
The existing refreshButton handler already catches errors and toasts manual results.

Only hydrateAfterBoot's catch gains a notice. 401/403 explain that access could not
be confirmed and advise reopening the app. Other failures explain that the profile
was not updated and retained data are shown. Internal provider/SQL details are not
copied into the toast. Token/profile/statuses and retry policy stay as before.
Success and optional design-render failure do not show a false failure notice.
Consent-controlled secondary reads retain their previous behavior. No automatic
reauthentication, wallet action, write request, new persistent UI or route change.

Owner benefit: a background failure no longer silently presents retained profile
data as if refresh succeeded. This is an existing profile UX correction, not a new
dashboard or tenant feature. Existing toast disappears after its normal 2.8 seconds;
this does not add a persistent freshness indicator.

## Verification

8 focused Node checks: success, 401, 403, 503, transport error, missing profile,
consent guard and optional design failure. Full materialized node --test: 444/444;
npm run check and explicit manual-verifier syntax/diff checks pass. Two full npm run
materialize executions are byte-identical across 393 existing tracked files. The fix survives
the full patch chain. No scripts retired; generated runtime changes are discarded.

Manual verifier: `node scripts/verify-profile-hydration-notice.mjs`, with the same
optional Playwright/Chromium path settings already used by project browser tools.
24 cases on canonical and materialized sources: Telegram/VK, 390/1440 px, successful
refresh, 401, 403, 503, invalid profile and disconnected socket. Executes original
boot/finish/scheduler/profile/status renderer, API/fetch, toast and refresh listener
on the current stripped-script HTML/CSS shell. Visible notice stays within viewport;
retained spend/balance/token are preserved. Actual refresh-button click recovers to
confirmed fixture spend and the existing success notice. No page or core-render error.

Loopback HTTP supplies fixture bootstrap/profile data; every API request is GET.
Bridge/auth/design/avatar/achievements/beer/shift/secondary jobs are adapters. No live
auth, HMAC/SQL or full app-script proof is claimed by this verifier; #203's previous
independent auth/SQL evidence was not imported. JS fetch instrumentation establishes
one background hydration attempt. Chromium may transparently repeat GET on a closed
socket; those low-level retries are distinct from the application's retries=0 policy.
The browser's local binary was truncated and crashed before page creation; a temporary
standalone browser tool was restored outside the repository. No project dependency
or environment configuration was added.

npm audit: three existing moderate qs/body-parser/express findings, exit 1; no new
dependency. Public read-only probe: 16/16 reachable. This establishes public endpoints
only, not authenticated production flows. No production data, migration, service,
send, resource, merge or deploy performed. Server routes remain unchanged.

Still unverified: full cold boot with live provider identity, complete secondary
jobs/consent/navigation, tenant isolation, real fiscal data and concurrent PostgreSQL.
Next small stage: consider a persistent freshness indicator using this confirmed
failure/recovery contract, without changing authentication or financial operations.

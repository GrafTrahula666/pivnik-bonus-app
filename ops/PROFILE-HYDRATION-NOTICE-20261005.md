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

The background catch reports a safe failure toast. A persistent, polite live-status
banner under the topbar now also shows loading, access denied (401/403), or retained
profile data after failure. It survives the normal 2.8-second toast timeout. Both
background hydration and manual refresh hide it only after applying a confirmed
profile response. Invalid responses and repeated failures retain the old profile
and the banner. Manual errors still reject to the original refresh-button listener;
its success toast and existing GET retry policy are preserved.

The banner uses existing theme variables, wraps on mobile, and sits above the
shell's decorative background layers. No internal provider/SQL details are copied
into the banner. Token/profile/statuses, consent guard, retries and optional jobs
retain their previous behavior. No authentication, financial operation or server
route changes; no unmerged implementation imported.

Owner benefit: retained profile data remain visibly marked after an unsuccessful
refresh, and the existing refresh button removes that warning after recovery.
This improves the shared profile shell; it does not establish tenant-safe business
metrics or complete the admin platform.

## Follow-up review

Fresh origin/main remains 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5. Existing
#206 head a90d5e8 passed all three CI jobs before this follow-up. Open PRs and all
worktree statuses were checked again; foreign asset/runtime edits remain untouched.
This continues the same failure/recovery stage in #206 rather than opening another
PR containing overlapping work. During browser verification, visual inspection
found the new banner behind the shell background; its stacking order was corrected
and the verifier now checks elementFromPoint as well as text/viewport bounds.

## Verification

12 focused Node checks: success, 401, 403, 503, transport error, missing profile,
consent guard, optional design failure, persistent state, deferred manual success,
manual rejection and repeated invalid manual responses. Full materialized node --test: 448/448;
npm run check and explicit manual-verifier syntax/diff checks pass. Two full npm run
materialize executions are byte-identical across 396 tracked files. The fix survives
the full patch chain. No scripts retired; generated runtime changes are discarded.

Manual verifier: `node scripts/verify-profile-hydration-notice.mjs`, with the same
optional Playwright/Chromium path settings already used by project browser tools.
24 cases on canonical and materialized sources: Telegram/VK, 390/1440 px, successful
refresh, 401, 403, 503, invalid profile and disconnected socket. Executes original
boot/finish/scheduler/profile/status renderer, API/fetch, toast and refresh listener
on the current stripped-script HTML/CSS shell. Persistent notice stays within viewport and above the shell background after the
transient toast has fully faded;
retained spend/balance/token are preserved. Repeated failed manual requests retain the warning (the original GET retry policy
is checked). Actual refresh-button click shows loading, then recovers to
confirmed fixture spend and the existing success notice. No page or core-render error. Desktop/mobile screenshots inspected.

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
Concurrent refresh completion ordering and full app-script integration remain
unverified. Next small stage: exercise this notice through the complete shell
initialization with fixture provider/secondary responses, retaining the same scope.

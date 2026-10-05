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
| Profile refresh UX | Main plus #206 failure banner | Original linked-script startup, secondary outage, manual recovery and reopen | Live scope unproven; manual refresh does not retry optional reads | Review explicit retry of failed optional reads |

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

Still unverified: cold boot with live provider identity, consent changes, complete
navigation/staff/admin flows, nonempty secondary data, tenant isolation, real fiscal
data, concurrent refresh ordering and concurrent PostgreSQL.


## Complete linked-client startup evidence

Follow-up on 2026-10-05, current main still 18a0fa4; #206 head 5b4fab9 passed all
three CI jobs (release gate 1747, public observation 276, VK parity 621). Open PRs,
remotes, history and worktree states reviewed again; foreign changes preserved.
Only this diagnostic and report change in this follow-up, no runtime/UI changes.

`scripts/verify-profile-full-startup.mjs` now evaluates the exact renderAppIndex
function on local files and serves its HTML without stripping scripts. Chromium
loads complete app.js, account-link.js, red-cosmos-v2.js and, for VK, vk-platform.js.
No extraction/replacement of client loaders, renderers, event wiring, transport or
secondary jobs. Existing isolated verifier remains for repeated-failure coverage.

The fixture seeds a returning session into the original Telegram and VK user-123
storage keys. Provider SDK methods and HTTP payloads are explicit adapters. Original
SDK integration, profile rendering, DOM enhancement, consent gate, fetch wrappers,
secondary loaders and refresh-button listener run as shipped. Accepted-consent client
profiles receive empty achievements/catalog/promotions/shift/leaderboard and disabled
wallet/wheel fixtures; every secondary endpoint must actually be requested. No
staff/admin workflow or nonempty business-data correctness claim follows from that.

24 cases on canonical files and 24 on the full materialized chain: Telegram/VK,
390/1440 px, success, 401, 403, 503, missing profile and disconnected socket. One
application background GET is counted before wrappers; low-level Chromium GET retries
on closed sockets are distinct. Retained balance/spend/session, loaded secondary
state, persistent warning after toast opacity reaches zero, viewport bounds and
actual elementFromPoint visibility are asserted. Native refresh click shows loading,
then applies the confirmed profile and hides the banner. No page errors, boot errors,
core-render errors or unhandled rejections. The old RED COSMOS palette console.assert
is unrelated to this change and is not a boot-error assertion.

All HTTP traffic is loopback and off-origin requests are blocked, apart from locally
fulfilled Telegram SDK content. Financial/auth writes are forbidden by the fixture;
original VK diagnostic telemetry POST is captured locally and acknowledged only.
No server/auth/SQL composition or real provider session is involved. No native VK
hosting or production CSP/header proof: the original HTML renderer is used in a
fixture HTTP server. Full client startup with a warm fixture session is the exact
boundary established, not full production startup.

Validation: 448/448 node tests; npm run check and diagnostic syntax/diff checks pass.
Two full materialize executions identical across 397 tracked files. Full-file hashes
for all linked client scripts and shell/styles are emitted by the verifier for both
variants. No patch scripts retired; generated runtime differences are restored.
Audit: three existing moderate findings, no dependencies/configuration added.
Current public read-only probes: 0/16, then 8/16 (VK reachable, all Telegram requests
timed out). Cause remains unknown; authenticated production behavior is unverified.

Secondary-section failure composition is covered by the follow-up below.


## Secondary-section failure composition

2026-10-05: freshly fetched main remains 18a0fa4; #206 prior head 0fefc6f passed
all three CI jobs (release gate 1748, public observation 277, VK parity 622).
Open PRs/worktrees/remotes/history reviewed. New foreign Halloween navigation work
on origin/claude/project-thread-nthfpr (8a82e31, #204) remains separate; foreign
dirty assets/runtime files are untouched. This stage changes only the existing
complete-client verifier and this report, not runtime/UI or server routes.

The loopback fixture now fails promotions with HTTP 503 for two composed cases:
successful profile plus failed promotions, and failed profile plus failed promotions.
Both use the complete original linked-client startup. The original GET retry policy
makes two promotions attempts before the optional-job warning. Other secondary
loaders finish normally. The optional warning may replace the transient profile
toast, but the persistent profile banner remains visible after both toasts fade.
A successful profile does not acquire a false profile warning from the optional
failure. Balance/session remain unchanged; the actual refresh button restores the
confirmed profile and clears its banner even while promotions remain unavailable.

### Separate existing limitation

Manual profile refresh does not restart promotions: loadSecondaryData returns when
state.bootSecondaryStarted is already true. The existing optional warning explicitly
says those sections will update on the next opening. The verifier asserts no extra
promotions requests on manual profile refresh, then restores the fixture provider and
reloads the real page. Reopening makes one successful promotions GET and finishes
without another optional error. No behavior change or automatic write/retry is
introduced to address this separate limitation. A future retry change needs its own
bounded UI/data-refresh contract.

Validation: 32/32 complete-client cases on canonical files and 32/32 on the full
materialized chain (24 retained plus 8 new combinations across TG/VK, 390/1440 px).
448/448 node tests, npm run check and diagnostic syntax/diff checks pass. Two full
materializations are byte-identical across 397 tracked files. No scripts retired;
generated runtime differences are restored. npm audit retains three existing
moderate findings; no dependencies, services or product environment variables added.
Current public read-only probes: 8/16 (VK timed out), then 16/16 after repeating.
This is availability evidence only; no authenticated production flow is checked.

Owner benefit established on fixtures: an optional-section outage does not silently
remove the stale-profile warning or block profile recovery. No new owner workflow
was implemented in this diagnostic follow-up. Payload/SDK adapters, warm accepted-
consent client, empty secondary datasets, no server/auth/SQL composition and the
previous live-identity/tenant/concurrent-refresh/native-hosting limitations remain.
VK diagnostic POST is captured locally only; all other writes/off-origin traffic
are forbidden. No production data changes, sends, migrations, merge or deploy.

Next small stage: review the existing UI contract for explicitly retrying failed
optional reads, keeping profile confirmation separate from optional-section status.

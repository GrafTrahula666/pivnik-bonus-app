# CRM directory access states, 2026-10-06

Isolated branch fix/crm-directory-access-state-20261006 starts at fresh origin/main
18a0fa4e5d911952a7993c432a6e7fc50de9e8c5. MODULE-MAP read; no applicable AGENTS.
Origin branches, open drafts and existing worktrees reviewed. Foreign changes stay
untouched; no draft imported. Knowledge Base was read previously; starter-pack.md
remains unavailable. #207 now has all three successful CI checks.

| Function | Implementation | Evidence | Gap | Next step |
|---|---|---|---|---|
| Cash/POS | #174, dashboards #176 | Existing #201/#203 fixtures | Live fiscal/tenant binding unproved | Controlled connection proof |
| CRM directory | main admin-user-directory.js and app.js | Existing search/pagination/race tests | 401/403 shown as retryable outage | This stage |
| Customer history | Customer 360 #115/#106, scoped #96 | Draft repositories/tests | Full owner navigation/tenant composition unproved | Review existing detail entry separately |
| Bonus actions | main; #193/#199 | Existing SQL/replay fixtures | Real scoped workflow unproved | Approved ownership contract |
| Telegram | main broadcast-campaign-store | Existing tests | Provider retry proof incomplete | Isolated provider fixture |
| Achievements/frames | main grant/catalog | Existing tests | Manual scoped action incomplete | Audit grant workflow |
| Rights/audit | main authorization; #195 | Existing access tests | Live multi-tenant proof absent | Cross-tenant contract tests |

## Change

The directory loader treated 401/403 exactly like a temporary outage, including
an offered retry button. It now displays a session-expired/reopen message for 401,
an explicit access-denied message for 403 and hides retry for both. Network/503
errors keep the existing retry. Loading is cleared on every current failure;
request sequence/profile checks, API retry policy and server authorization remain
unchanged. A later explicit load can succeed after access restoration. The original
error is still rethrown to the existing caller. No server route, mutation, new
configuration/dependency, patch retirement or Customer 360 import.

## Validation and limits

Three new original-function tests cover 401/403, restoration and stale denial;
existing tests cover search races, loading, network retry and account changes.
Full materialized node --test passes 439/439; check passes. Two full materializations
are byte-identical across 395 tracked files. npm audit exits 1 with three existing moderate findings, no high
or critical. Generated runtime differences restored before commit.

Browser diagnostic uses original directory functions, HTML and styles at 390/1440
px: 8 canonical and 8 materialized cases pass. Fixture API and renderUsers adapter, forced modal visibility. It verifies
messages, busy reset, retry visibility, viewport bounds and 503 button recovery;
it does not prove full boot/navigation, signed accounts, user-card/history rendering,
server/SQL, provider or tenant isolation. All remote requests are blocked.

Production runtime not queried in this stage. No production data, resource, message,
migration, merge or deploy. This improves the owner's explanation of denied CRM
access; it does not grant access or claim the full Customer 360 scenario ready.
Next bounded stage: inspect the existing user-card/history entry against the draft
Customer 360 implementation without importing it automatically.

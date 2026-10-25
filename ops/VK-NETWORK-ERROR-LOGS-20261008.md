# VK network-error logs — 2026-10-08

## Verified starting state

Separate branch from freshly fetched origin/main a813f56a379fa4bf60f34722d44e0f7b7ed5a7b7.
Main release gate 37650995927 and VK parity 37650995810 succeeded. Open PRs,
remote branches and worktrees were inspected. Existing dirty asset in the original
worktree and other threads' work were untouched. No applicable AGENTS.md found.
ops/MODULE-MAP.md read; supplied knowledge-base was read in earlier stages;
starter-pack.md remains unavailable.

| Function | Existing implementation | Verification | Concrete gap | Next step |
| --- | --- | --- | --- | --- |
| Cash / Evotor | Main pos/*; Business drafts #174/#176/#210 | Existing tests; #220 envelope proof | No real till/provider evidence | Real integration review separately |
| Dashboard / CRM / Customer 360 | Main overview; drafts #96/#115/#208/#212 | Existing scope/HTTP/SQL fixture evidence | Owner browser workflow not verified | Keep scoped read-only rollout separate |
| Bonus corrections | admin-adjustment-persistence.js; drafts #182–#199 | Existing atomicity/replay tests | UI draft not part of main | Review composed owner scenario |
| Achievements / frames | achievements.js, main admin/staff routes | Existing regressions | Complete owner mobile scenario unverified | Dedicated workflow proof |
| Telegram / VK campaigns | Main broadcast-campaign-store.js; drafts #221/#222/#223/#227/#230 | Earlier full gateway proofs; no live send | VK transport catch logs exception prose | Fixed-code network log in this stage |
| Audit / rights | authorization-* and explicit membership repositories | Existing denial tests; current synthetic gateway | Campaign has actor but no business scope | Scope campaign creation and audience before owner history |

## Reproduction and minimal change

The actual sender source under VM logs an exception containing a synthetic token,
request URL and recipient detail. Rejecting null also escapes the catch because
error.message is dereferenced. Two new regression tests fail on unchanged main.
The VK transport catch now logs only vk_network_error and never reads thrown
properties. Three source-execution tests cover aggregation, Error/cause prose,
null/undefined/primitive rejection, throwing message getter, no automatic retry,
explicit recovery and missing configuration. Exception prose is not necessary to
understand the owner-visible failure; its diagnostic code is retained.

Only server.js sender catch changes. No new API, UI, dependencies, schema, env,
provider retry or patch retirement. Universal gateway proxies the existing admin
broadcast route to this sender; it has no duplicate VK sender. Auth/role/consent
and recipient selection are unchanged. No code imported from other drafts:
#230 concerns provider payload errors; #227 deadline and #223 confirmation remain
separate. Telegram exception logs/provider prose are a separate existing gap.

## Limits

No production database/data changes, real sends, merge or deployment.
Live VK/Telegram, network PostgreSQL concurrency and owner desktop/mobile are
unverified. No tenant-isolation or campaign-history availability claim.
A network failure does not prove the provider never accepted the request.

## Validation results

- node --test: 517/517 pass (main has 514; three new regressions).
- npm run check succeeds; npm audit reports 0 vulnerabilities.
- npm run materialize twice: 473 tracked-file SHA-256 hashes identical. Generated
  runtime changes restored afterward; tested VK sender bytes match canonical.
- Actual universal-server.js + spawned server.js: 22 HTTP requests, 10 loopback
  provider requests, 5 completed synthetic campaigns. Signed-session/role/consent
  denials, invalid channel/audience/empty/oversized text, success, socket disconnect,
  injected exception with fake token/recipient/URL, explicit recovery, combined
  Telegram+VK, and replay via Telegram/VK admin sessions passed. No provider calls
  on denied/invalid requests; no additional calls on replay.
- Six VK transport failure logs contain fixed vk_network_error only. Fake token,
  recipient prose and provider URL are absent from stdout/stderr, HTTP responses
  and campaign rows. Other 33 fixture tables unchanged, 169 startup SQL queries.
- Fixture uses in-memory PGlite instead of pg and adapts advisory locks; provider
  URLs are redirected only in the test process, with other outbound URLs blocked.
  This is not evidence of real provider delivery or PostgreSQL lock concurrency.

Next small stage: check Telegram network-exception logs for the same disclosure
class, without combining it with payload-error summaries or campaign tenant scope.

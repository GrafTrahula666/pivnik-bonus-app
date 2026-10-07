# Telegram network-error logs — 2026-10-08

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
| Telegram / VK campaigns | Main broadcast-campaign-store.js; drafts #221/#222/#223/#227/#230 | Earlier full gateway proofs; no live send | Telegram transport catch logs exception prose | Fixed-code network log in this stage |
| Audit / rights | authorization-* and explicit membership repositories | Existing denial tests; current synthetic gateway | Campaign has actor but no business scope | Scope campaign creation and audience before owner history |

## Reproduction and minimal change

Three source-execution regression tests fail on unchanged main: arbitrary exception
text reaches logs, null rejection escapes the catch, and a 429 retry followed by a
network exception logs private prose. The Telegram transport catch now logs only
telegram_network_error and never reads thrown properties. Four tests verify
Error/cause prose, null/undefined/primitive rejection, throwing message getter,
aggregation, no automatic network retry, explicit recovery, missing configuration
and existing bounded 429 retry. Only the Telegram catch changes; no new API/UI,
dependencies, environment, schema, timeout policy or patch retirement.

Universal gateway proxies broadcast to server.js; it has no duplicated Telegram
sender. Auth/role/consent and recipient selection are unchanged. Other Telegram
call sites use this same sender. Open #221/#222/#223/#227/#230/#231 remain separate;
no draft code imported. Telegram provider payload description and VK exception
logs are separate existing gaps, left untouched here.

## Limits

No production database/data changes, real sends, merge or deployment.
Live Telegram/VK, network PostgreSQL concurrency and owner desktop/mobile are
unverified. No tenant-isolation or campaign-history availability claim.
Network failure does not prove the provider never accepted the request.
Knowledge base reviewed in earlier stages; starter-pack.md remains unavailable.

## Validation results

- node --test: 518/518 pass (main: 514; four new tests); npm run check passes;
  npm audit reports 0 vulnerabilities.
- npm run materialize twice: 473 tracked-file SHA-256 hashes identical. Generated
  runtime changes restored; tested Telegram sender bytes match canonical sender.
- Full universal gateway with spawned server.js: 24 HTTP scenarios, 14 loopback
  provider calls, six completed synthetic campaigns. Signed-session/role/consent
  denials, invalid inputs, success, socket disconnect, injected secret-bearing
  exception, actual HTTP 429 followed by one permitted retry and disconnect,
  explicit recovery, combined Telegram+VK and deduplicated replay all passed.
- Eight transport failure log entries contain only telegram_network_error. Test
  token, provider URL and private recipient prose absent from captured logs,
  HTTP responses and campaign rows. Other 33 fixture tables unchanged; 169
  startup SQL queries. No provider calls on denied or invalid input requests.
- Local PGlite broker replaces pg and adapts advisory locks; test-only provider
  URLs go to loopback and other outbound network is blocked. This does not prove
  real delivery, PostgreSQL concurrency, owner UI or tenant isolation.

Next small stage: validate Telegram provider payload error descriptions before
exposing them in campaign responses, preserving bounded provider retries.

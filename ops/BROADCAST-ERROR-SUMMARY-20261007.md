# Campaign error summary retention

Base: verified origin/main d4ec0c30a55a84653cf46711792aa48d16408d2f.
Branch: fix/broadcast-error-summary-20261007. One stage: retain safe aggregate
failure reasons when an existing campaign is returned on replay.

Confirmed gap: complete() discarded error breakdowns and replay returned only
attempted/delivered/failed. An owner could see failures without their original
machine-code reason. Separate confirmation guard PR #221 is not imported.

Two nullable JSONB columns retain at most eight aggregate entries per channel.
Counts cannot exceed the channel's failed count; duplicates merge. Only known
Telegram/VK machine codes are retained. Free-form provider descriptions map to
channel_send_failed: no raw provider text, recipient IDs, tokens or message body
is stored. NULL means unknown historical breakdown; [] means a supplied empty
breakdown. The summary may be partial; it does not invent omitted reasons.

ensureSchema uses additive IF NOT EXISTS columns for existing installations.
Old rows retain NULL; no backfill or destructive migration. This schema change
was executed only in isolated PGlite. Deployment would require review of the
additive startup DDL; production database was not accessed in this run.

No route, auth, retry, channel selection, fingerprint or UI change. The gateway
has no duplicate campaign store or broadcast handler; its existing proxy reaches
the same server.js store. No manual/automatic replay sends were introduced.
The first response remains the existing live aggregate; replay returns safe
stored codes, so free-form descriptions are deliberately not round-tripped.

| Function | Existing implementation | Verification | Gap | Next step |
| --- | --- | --- | --- | --- |
| Broadcast history/replay | Main campaign store and broadcast route | New SQL upgrade/completion/replay tests | No owner history UI or recipient retry ledger | Read-only campaign history scenario |
| Telegram confirmation | Draft #221 | Same-head CI and prior full gateway proof | Not merged, live provider unverified | Review independently |
| Cash/Evotor | Main #217/#219, draft #220 | Prior SQL/HTTP/CI evidence | Live till/PostgreSQL absent | Connection proof with access |
| CRM/Customer 360 | Main directory, drafts #96/#115/#208 | Prior scope/SQL/gateway proof | Browser/navigation unresolved | Existing card scenario |
| Bonuses/achievements/frames | Existing main modules, draft fixes | Existing unit/SQL proof | Complete scoped owner action unverified | One journal-backed action |
| Rights/audit | Existing sessions, consent, roles, membership | Existing tests and fixture evidence | Production tenant isolation not proven here | Tenant-scoped proof |

Checks and runtime follow-up are recorded in the PR. No new dependency, service,
environment variable, production data change, real message, merge or deploy.
starter-pack.md remains unavailable; knowledge-base DOCX reviewed previously.

## Verification results

512/512 node tests, npm run check passed, npm audit 0 vulnerabilities.
Two materializations byte-identical across 472 tracked files. New tests execute
actual store SQL in PGlite: legacy schema upgrade twice, preserved legacy fields,
NULL historical reasons, completion/replay of both channels, failed SQL recovery,
invalid inputs without SQL, bounded/merged counts and secret-text exclusion.

Disposable full-runtime follow-up: 22 client HTTP requests through complete
materialized universal-server.js and its spawned server.js; 170 startup SQL calls
on shared in-memory PGlite. Actual signed identity/session/consent/role checks and
recipient SQL executed. Denials and invalid inputs make zero provider calls;
only two subscribed non-deleted/non-merged client fixtures are selected.
A real loopback HTTP provider returned confirmations, explicit 403 failures,
socket disconnects and bounded 429 retries. Five campaign rows store expected
counts/error summaries. Telegram and VK admin replay return the same Telegram
error summary; network failure replay preserves reasons without new sends.
12 local provider HTTP calls total; digest snapshots of all 33 other initialized
tables match. Provider text and recipient IDs are absent from stored summaries.

Limits: test-only pg SQL broker/advisory-lock adaptation and provider URL rewrite;
no network PostgreSQL locking/concurrency, live Telegram/VK, production tenant
isolation, browser desktop/mobile or owner history UI proof. Full-runtime harness
is disposable evidence, not an added automated CI test. Product UI is unchanged.

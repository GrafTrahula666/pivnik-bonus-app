# Evotor response envelope validation

Base: verified origin/main `d4ec0c30a55a84653cf46711792aa48d16408d2f`.
Stage: reject malformed provider response envelopes before importing documents.

## Confirmed defect and change

On the unchanged base, a successful HTTP response containing JSON `null` throws
an unclassified TypeError when the reader accesses `page.items`. The sync layer
then records `invalid_document` rather than `invalid_response`. An array/string/
boolean `paging` value was accepted as a final page, allowing the saved cursor
to be cleared even though the pagination envelope is malformed.

The reader now requires an object response and an object pagination envelope
when pagination is present. Missing/null pagination and missing/null/string
next_cursor remain compatible with the existing reader contract. Existing item
count and cursor type checks are preserved. Invalid envelopes produce the same
safe `invalid_response` error as invalid JSON, without echoing provider content.

No HTTP routes, auth, tenant scope, schema, UI or financial writes were changed.
Both servers use the same POS service/reader implementation. No patch retired.

## Existing implementations and gaps

| Function | Existing implementation | Verification | Gap | Next step |
| --- | --- | --- | --- | --- |
| Cash/Evotor and two dashboards | Main #217/#219, pos modules | Existing SQL/HTTP tests; new malformed-response tests | Real device/API sync unverified | Read-only real connection proof when access is available |
| CRM directory | Main admin-user-directory; draft #208 access states | Existing tests; draft inventory | Complete owner search/card flow unverified | Reuse directory and existing card |
| Customer 360 | Draft #96, separate legacy draft #115 | Prior isolated 52-case public gateway proof; source review | Missing navigation/auth transport bridge, access/retry states; browser blocked | Separate card state/retry stage with browser proof |
| Bonus adjustments | Main persistence; drafts #182–#199 hardening/result proofs | Existing isolated SQL tests | End-to-end confirmed owner action unverified | Reuse journal/idempotency; do not enable draft write composition |
| Telegram campaigns | Existing broadcast campaign store and routes | Existing deduplication tests | Complete preview/retry owner flow unverified | Isolated provider adapter proof; no real campaign |
| Achievements, frames, audit and rights | Existing achievement/frame modules and SQL membership adapters | Existing tests and prior read-only scope proof | Complete tenant-owned action/UI proof unverified | One scoped action at a time |

## Validation and limits

- Reproduced original null TypeError and accepted malformed paging on main.
- Reader tests cover 11 malformed envelopes, malformed JSON and five compatible
  successful envelopes. Existing reader tests cover 401/402/403/429/network errors.
- Real reader plus sync/repository in PGlite: malformed null/array-paging responses
  return 502 invalid_response; document snapshots and cursor/scan deadline/last
  successful sync remain unchanged. Existing sales remain readable with an error
  status. Recovery resumes the saved cursor; replay retains one sale and no
  application transaction is inserted.
- Existing suite covers viewer/client/staff denials and tenant/location isolation.
- Materialize twice: 470 tracked files byte-identical between runs.
- Full node tests: 512/512 passed. npm run check passed; npm audit found zero
  vulnerabilities. Materialization-only changes were restored before commit.

Synthetic SQL fixture only. Advisory locks are adapted by the existing PGlite
test helper; network PostgreSQL concurrency and live Evotor payloads were not
verified. UI unchanged; desktop/mobile card proof remains blocked by unavailable
Chromium and cloud browser rejection of the local fixture. No new owner feature
is claimed: this prevents malformed pagination from marking sync complete and
labels provider errors correctly while retaining confirmed sales.

The requested knowledge-base DOCX was reviewed earlier; starter-pack.md remains
unavailable in the supplied files. No production DB/data, messages, migrations,
merge or deployment were touched.

## Follow-up: provider HTTP and both POS route boundaries

The existing evotor-http-boundary verifier now exercises sync through the actual
extracted auth and POS route registrations of both server.js and universal-server.js.
Twenty additional client HTTP requests cover forged auth, viewer write denial,
foreign store denial, invalid store input, malformed null/array-paging provider
responses, reading preserved sales, recovery and a repeated successful scan.
Denied/invalid requests make zero provider calls.

The real shared reader receives real fetch responses from a local HTTP provider
fixture: eight requests across both runtimes. Only its external origin is redirected
to loopback; its method, path, cursor and synthetic authorization header are preserved.
The first three calls per runtime retain resume-page; the next scan starts without
a cursor. Failures return 502 invalid_response; documents and saved scan progress
remain unchanged; the dashboard still reports the two existing sales (60 cents).
Recovery and repeat keep two documents, and wallet/journal snapshots are unchanged.

This uses the existing reduced PGlite schema and adapted advisory-lock functions.
It does not prove complete process startup, actual getProfile joins, concurrent
network PostgreSQL, live Evotor, or browser UX. No product behavior was changed
in this follow-up; test coverage and evidence were extended for the same fix.

Follow-up checks: materialize twice, 471 tracked files byte-identical; node --test
514/514; npm run check passed; npm audit zero vulnerabilities. Materialization-only
changes restored before commit. UI and HTTP route implementations unchanged.

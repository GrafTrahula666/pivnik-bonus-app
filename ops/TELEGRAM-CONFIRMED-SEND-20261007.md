# Telegram confirmed send result

Base: verified origin/main d4ec0c30a55a84653cf46711792aa48d16408d2f.
Branch: fix/telegram-confirmed-send-20261007. One stage: prevent ambiguous
Telegram provider replies from being counted as successful sends.

## Confirmed defect and owner outcome

Reproduced the original actual sender on unchanged main with HTTP 200 HTML:
it returned {ok:true,status:200,messageId:null}. JSON parsing errors silently
became an empty object; the campaign aggregator counted this as delivered.

The sender now requires explicit ok:true and a non-negative safe integer
result.message_id before returning success. Otherwise it returns
telegram_invalid_response without automatically resending an ambiguous send.
The existing failed counter means a send was not confirmed; it does not prove
that the recipient did not receive it. Confirmed sends still do not establish
reads or purchases. Message ID 0 remains compatible with the documented API.

Official contract checked 2026-10-07:
https://core.telegram.org/bots/api#making-requests and
https://core.telegram.org/bots/api#message.

## Existing implementations and remaining gaps

| Function | Found implementation | Verification | Concrete gap | Next step |
| --- | --- | --- | --- | --- |
| Telegram campaigns | Main sender, deliverBroadcast, campaign store and admin routes | New sender and extracted HTTP/SQL tests | No recipient-level retry/history workflow | Audit existing campaign lifecycle with fixture provider |
| Cash/Evotor | Main #217/#219; draft #220 response guard | Existing tests; #220 exact-head CI passed | Live API/device and real PostgreSQL unverified | Connection proof when access exists |
| CRM/Customer 360 | Main directory; drafts #96/#115/#208 | Prior scope/SQL proof; source inventory | Card access/retry/navigation and browser proof absent | Reuse card with browser proof |
| Bonus corrections | Main persistence; drafts #182–#199 | Existing SQL/idempotency proofs | Complete owner action not verified | One journal-backed action |
| Achievements/frames | Existing modules and handlers | Existing tests | Tenant action/browser proof incomplete | One scoped action |
| Rights/audit | Existing auth, membership, campaign audit store | Prior scope tests; new campaign counts | New test uses fixture auth; no full gateway session proof | Full gateway read-only proof |

## Verification boundaries

Three added tests execute the actual source functions and actual extracted
broadcast POST registration. Eleven malformed JSON structures, HTML, truncated
JSON and empty body never succeed or retry. Valid ID 0/7/MAX_SAFE_INTEGER,
unconfigured sender, 401/403/500, network failures and bounded one-time 429
retry are covered. Timers are immediate fixture callbacks, not real delay proof.

Eight loopback HTTP requests: missing fixture auth, viewer/staff denial, invalid
text/channel/audience (zero provider calls and no audit rows); a mixed successful
campaign (one success, one malformed response); and deduplicated replay. Actual
campaign SQL in PGlite preserves the exact campaign row on replay and performs
only two fixture provider calls. No external provider request is made.

Authentication/role middleware and recipients are fixture adapters; PGlite
advisory transaction locks are adapted. This does not prove production auth,
tenant composition, recipient consent SQL, concurrency, full server startup or
live Telegram. Existing source consent filters and admin route guards unchanged.

Parity review: universal-server.js has no duplicate broadcast handler or sender;
the route reaches server.js via its existing generic API consent/proxy path.
No gateway route, permission or UI changed. Sender is shared with existing staff
notifications; its return shape and await behavior remain compatible.

Required checks: 513/513 node tests; npm run check passed; npm audit zero
vulnerabilities; materialize twice byte-identical across 472 tracked files and
preserves the new guard. Generated-only changes restored before commit. No patch
retirement, new dependency, environment variable, schema migration, production
write, real message, merge or deploy.

Separate backlog, not part of this fix: VK sender also accepts missing provider
confirmation; Customer 360 browser remains blocked. starter-pack.md remains
unavailable; requested knowledge-base DOCX reviewed previously. Next small stage:
verify ambiguous Telegram replies through the full gateway with a local provider.

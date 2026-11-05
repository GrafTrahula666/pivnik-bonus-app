# VK single-recipient confirmation

Base: verified origin/main d4ec0c30a55a84653cf46711792aa48d16408d2f.
Branch: fix/vk-confirmed-send-20261007. One stage: stop counting ambiguous VK
messages.send responses as successful sends.

Reproduced main sender with HTTP 200 HTML: ok:true/status:200/messageId:null.
The actual request supplies one user_id; now response must be a non-negative
safe integer message ID. Missing, malformed, wrong-type or unsafe response
returns vk_invalid_response with no retry. Valid ID 0 is preserved: official
integer schema has no positive minimum. Existing random_id construction,
configuration, explicit provider errors and network handling remain unchanged.
No assertion about read status or purchase attribution follows a confirmed send.

Official VKCOM API schema 5.199 inspected 2026-10-07:
https://github.com/VKCOM/vk-api-schema/blob/master/messages/methods.json
https://github.com/VKCOM/vk-api-schema/blob/master/messages/responses.json
messages_send_deprecated_response requires integer response; the separate
userIdsResponse array is for bulk recipient requests, not the current user_id
call. This guard does not add a bulk-send variant or change the API version.

| Function | Found implementation | Verification | Gap | Next step |
| --- | --- | --- | --- | --- |
| VK campaign delivery | Main sender/aggregator/admin route/store | Actual-source tests plus local gateway proof | Live provider unverified | Review confirmed-send fix |
| Telegram confirmation | Draft #221 | Prior same-head CI/gateway proof | Not merged | Separate review |
| Campaign error summary | Draft #222 | Prior SQL/gateway/TG+VK proof | Not merged; new vk_invalid_response needs whitelist integration when combined | Separate integration review |
| Owner campaign history | Main store, no list UI/API | Source review | No tenant attribution on campaign rows; admin is global | Explicit business scope before history route |
| Cash/Evotor | Main #217/#219, draft #220 | Prior HTTP/SQL/CI proof | Live connection absent | Connection proof |
| CRM/bonus/achievements/frames | Existing modules and draft scenarios | Prior scope/SQL proof | Complete owner browser/action scenario unverified | One existing scoped action |

No draft code imported. This fix alone does not persist failure breakdowns:
current main replay stores counts only; #222 remains separate. No tenant history
route enabled, new dependency/env/schema/UI/route/auth change, patch retirement,
production data access, real messages, merge or deploy. Gateway has no duplicate
VK sender or broadcast handler; unchanged generic proxy reaches server.js.

Two tests use actual sender source: malformed response structures, HTML,
truncated/empty JSON, valid 0/7/MAX_SAFE_INTEGER, POST/form/random_id contract,
missing config, explicit 401/403/429/500 provider failures and socket-style
network exception, with no sender-level retry. No live API proof. Current
custom VK_API_VERSION values beyond the documented 5.199 response contract
were not independently verified.

starter-pack.md remains unavailable; knowledge-base DOCX reviewed previously.

Verification completed 2026-10-07: 512/512 node --test; npm run check passed;
npm audit: 0 vulnerabilities. Two complete npm run materialize executions
produced byte-identical hashes for all 472 tracked files. Generated-only
changes restored; canonical sender is byte-identical to tested gateway sender.

Full universal-server.js gateway with spawned server.js: 23 client HTTP cases,
12 loopback provider HTTP calls, five completed campaign rows. Actual signed
auth, roles, consent and recipient SQL exercised. Denial/invalid input, preview,
mixed confirmed/HTML response, all-invalid responses, socket failure, recovery,
combined Telegram/VK and campaign replay checked; replay makes no extra send.
All 33 non-campaign table snapshots unchanged after 169 startup SQL statements.
No second VK sender or broadcast handler exists in universal-server.js; its
unchanged proxy reaches the tested server.js implementation.

Limits: isolated in-memory PGlite adapter replaces network PostgreSQL; advisory
locks adapted. No PostgreSQL concurrency, live VK/Telegram delivery, production
configuration/data or end-to-end tenant isolation proof. UI unchanged, hence
no new desktop/mobile claim. Existing browser runtime blocker remains.

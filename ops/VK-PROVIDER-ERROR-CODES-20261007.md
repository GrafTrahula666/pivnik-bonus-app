# VK provider error codes

Base: verified origin/main a813f56a379fa4bf60f34722d44e0f7b7ed5a7b7, 2026-10-07.
Branch: fix/vk-provider-error-codes-20261007. One stage: remove arbitrary VK
provider prose from campaign responses and provider-error log entries.

Reproduced with actual main sender and delivery aggregator: error_msg containing
synthetic access-token/private recipient detail becomes vk.errors[].error.
Malformed error_code text is also interpolated into results/logs. Return only
vk_<positive safe integer> or vk_send_failed. HTTP status/counts and no-retry
behavior preserved. Do not log arbitrary provider error_code/error_msg.
Owner can inspect safe failure codes without provider prose leaking in the API.

Three actual-source tests check first-response campaign summary and logs,
provider HTTP 200/401/403/429/500 errors, malformed code types, confirmed send,
missing config. Regression checks fail before fix. No live provider request.

| Function | Found implementation | Verification | Gap | Next step |
| --- | --- | --- | --- | --- |
| VK error response | Main server sender/aggregator | Actual-source tests | Provider prose returned raw | Safe numeric codes in this stage |
| VK deadline | Draft #227 | Prior tests/CI/gateway | Not merged | Separate review |
| Send confirmation | Draft #223 and #221 | Prior tests/CI/gateway | Independent work | Separate review |
| Persisted error summary | Draft #222 | Prior SQL/gateway | Main replay stores counts only | Separate review |
| Owner campaign history | Main legacy global admin/store | Source inspection | No tenant attribution/recipient scope | Scoped creation before history |
| Cash/CRM/actions/audit | Existing main modules and drafts | Prior HTTP/SQL evidence | Live owner scenario unverified | One existing scoped scenario |

No unrelated draft code imported. No UI/auth/routes/schema/env/dependency change,
patch retirement, real campaign, production data, merge or deploy. Universal
server has no second VK sender/broadcast implementation; unchanged proxy uses
server.js. No actual desktop/mobile campaign scenario claim. starter-pack.md is
unavailable; knowledge-base DOCX previously read.

Explicit remaining gap: network-exception logging uses error.message, and
Telegram provider prose uses a separate sender. Those are not changed here.
Timeout and malformed-success fixes remain independent PRs; no overall tenant
isolation claim. Safe error codes do not establish non-delivery/read/purchase.

Verified: 517/517 node --test; npm run check; npm audit (0 vulnerabilities).
Two complete materialize runs produced byte-identical hashes for 473 tracked
files. Generated-only changes restored; canonical sender byte-identical to
materialized sender used by gateway fixture.

Full universal-server.js spawning server.js: 23 client HTTP cases, 12 loopback
provider requests, five completed campaign rows. Actual signed auth/roles/consent
and recipient SQL. Mixed VK errors, invalid error-code text, network failure,
recovery, Telegram+VK, denied access, bad input, preview and cross-platform
replay checked. Synthetic provider token/private prose absent in all HTTP
responses and persisted campaign rows; replay makes no additional provider call.
33 non-campaign table snapshots unchanged after 169 startup SQL statements.

Limits: PGlite adapter replaces network PostgreSQL; advisory locks adapted. No
PostgreSQL concurrency, live provider or production tenant isolation proof.

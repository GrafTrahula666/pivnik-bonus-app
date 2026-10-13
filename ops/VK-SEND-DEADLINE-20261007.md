# VK send deadline

Base: origin/main 86751a759cacdce165fb53ab3d2eb2ee6c6f80c1 verified 2026-10-07.
Branch: fix/vk-send-deadline-20261007. Existing recipient rules from merged
#225/#226 preserved. Independent drafts #221/#222/#223 not imported.

Confirmed gap: sendVkCommunityMessage fetch and response-body read have no
abort signal. A stalled provider leaves sequential campaign delivery awaiting
that recipient indefinitely. Existing Telegram sender already uses 8 seconds.
Add an 8-second AbortSignal.timeout for each VK request, covering headers/body.
After the existing JSON catch, throwIfAborted prevents body abort from becoming
an apparent success. Existing vk_network_error is returned; no automatic retry.
A timed-out request may have reached VK: it is unconfirmed, not proven undelivered.
Campaign replay must not resend it. No per-campaign total deadline is added;
sequential recipients can still take up to 8 seconds each plus pacing.

Actual-source regression tests fail on the unmodified sender; fixed tests check
header stall, body stall, success, provider errors, network failure and absent
config. Real loopback HTTP tests use the actual 8-second deadline for both stalls.
Native API reference inspected 2026-10-07:
https://nodejs.org/download/release/v22.15.0/docs/api/globals.html

| Function | Existing implementation | Verification | Gap | Next step |
| --- | --- | --- | --- | --- |
| VK send | Main server.js | Deadline regression and local HTTP | Live VK unverified | Review bounded send |
| Send confirmation | Draft #223 VK / #221 Telegram | Prior CI and gateway evidence | Separate unmerged fixes | Separate review |
| Campaign errors | Draft #222 | Prior SQL/gateway proof | Main replay only has counts | Separate review |
| Business history | Legacy global admin routes/store | Source review | Rows, fingerprint and recipients lack tenant scope | Explicit scoped creation before owner history |
| Cash/Evotor | Main and draft #220 | Prior HTTP/SQL evidence | Live cash connection unverified | Connection proof |
| Customer 360/actions | Existing modules and draft scenarios | Prior auth/SQL evidence | Owner desktop/mobile flow unverified | Existing scoped action |

No UI/auth/route/schema/dependency/env change, patch retirement, real messages,
production DB/data access, merge or deploy. Universal gateway has no duplicated
VK sender/broadcast handler: unchanged proxy reaches server.js. starter-pack.md
unavailable; knowledge-base DOCX previously reviewed. Browser workflow and live
PostgreSQL/provider delivery remain unverified.

Verification: 517/517 node --test; npm run check passed; npm audit reports 0
vulnerabilities. Two complete materialize executions byte-identical across 473
tracked files. Generated-only changes restored; canonical sender matches the
materialized sender tested through gateway byte-for-byte.

Actual universal-server.js spawning server.js, signed auth/roles/consent and
recipient SQL: 21 client HTTP cases, 8 loopback provider requests, four completed
campaign rows. Header/body stalls use unmodified real 8000 ms deadlines; each
campaign completes with one failure and one success. Replay through VK identity
makes no new provider call and preserves stored campaign rows. Network failure,
recovery, denied access, bad input and preview also checked. All 33 non-campaign
table snapshots unchanged (169 startup SQL statements). Only synthetic data.

Limits: PGlite replaces network PostgreSQL; advisory locks adapted. These checks
do not prove PostgreSQL concurrency, live provider delivery or tenant isolation.
UI unchanged; no owner desktop/mobile scenario claim. Existing malformed VK
response acceptance remains main behavior and is handled separately by #223.

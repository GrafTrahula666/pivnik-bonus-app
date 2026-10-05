# POS signed-session boundary evidence, 2026-10-05

Branch directly from freshly fetched origin/main 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Remotes/history/worktrees/origin branches and open PRs reviewed. MODULE-MAP read;
no applicable AGENTS found. Previously read starter/knowledge context retained.
Foreign dirty work preserved. #202 release gate, hosting parity and public observation
all passed. #201/#202 remain separate drafts; their implementation is not included.

| Function | Existing implementation | Verification | Specific gap | Next step |
|---|---|---|---|---|
| Cash/Evotor | Disabled #174 | #201 SQL/HTTP evidence | Real fiscal samples/store onboarding absent | Controlled onboarding review |
| Dashboards | #174/#176 | Fixture sales/replay | Approved venue binding absent | Existing binding review |
| CRM/Customer 360 | Main + #96/#115 | #196/#197 scope evidence | Visibility is not wallet ownership | Trusted ownership contract |
| Bonus corrections | Main + #193/#199 | SQL/recovery/replay evidence | Complete signed entry absent | Isolated entry composition |
| Telegram | Main campaign store | Existing suite | Live provider retry unverified | Local retry provider |
| Achievements/frames | Main + Business grants | Existing suite | Scoped grant workflow unverified | Audited grant scenario |
| Rights/audit | Main gateway + disabled #174 routes | This signed-session HTTP diagnostic | Tenant/store isolation unproven | Compose boundary with actual POS service |

## Selected stage

Verify the existing signed-session admission boundary before claiming the POS
workflow is authorized. No production regression found in these cases. Added only
a manual diagnostic and this report; owner panel behavior is unchanged.

`node scripts/verify-pos-session-boundary.mjs` reads the three POS route blocks
from exact local git object 776c70d691540b01bbc56a1496203e6cc918eea6 (#174).
It does not fetch missing objects, import that draft into startup, or copy its
implementation into this branch. Current gateway canonicalizeSessionToken and
requireGatewayUser functions are extracted verbatim and asserted byte-equal to
the pinned draft. Their real platform-core HMAC verifier/effective-role helper
and actual identity/session SQL execute in disposable PGlite through local HTTP.

54 named checks across Telegram/VK: all three authorized routes, repeated
admission, missing/forged/wrong-secret/expired tokens, invalid user/version,
staff token denial, missing/cross-provider identity, missing actor, revoked
session version, deleted/merged actor, outdated consent, viewer read versus write,
client read refusal, permission before malformed-body parsing, malformed/oversized
body and identity database outage. Each refusal has zero service calls. A mismatched
X-Platform header cannot override the signed identity. Each request preserves the
entire fixture users/identities snapshot. Retry rechecks the current session.

## Evidence and precise limits

54/54 pass on canonical and fully materialized gateway sources with identical
boundary/route hashes. Full materialized node --test: 436/436; npm run check passes.
Two materializations have identical SHA256 snapshots across 395 tracked/new files. npm audit
retains the three existing moderate qs/body-parser/express findings (exit 1).
Generated runtime changes restored. No dependency, environment variable, schema,
route, UI or auth implementation change; no patch retirement. server.js and
universal-server.js are unchanged in the final diff; no route parity change.

This is not full auth issuance or production identity verification: a fixture
secret signs application sessions; provider launch/authentication is not executed.
Fixture DDL supplies only users/identities columns needed by the actual queries;
the adapter maps PGlite row count to node-pg. Minimal HTTP/error/body adapters are
diagnostic. POS methods are service spies: this establishes admission, not financial
execution/replay, real provider behavior or audit writes. Staff case tests missing
staff subject, not every legitimate terminal/staff combination. No real tenant/store
binding or independent PostgreSQL contention is established. No UI change, hence
desktop/mobile testing is not applicable to this server-boundary-only stage.
No production data/configuration, sends, merge or deploy touched.

Public read-only runtime probe: first pass had eight VK timeouts; one bounded
repeat passed 16/16 Telegram/VK responses. Cause not established. Authenticated
production operations and actual business data were not queried.

Next bounded stage: replace the POS service spy with the existing pinned actual
service in the signed-session fixture and verify rejection/recovery leaves financial
and audit state unchanged. Approved business/store mapping and provider samples
remain prerequisites for production enablement.

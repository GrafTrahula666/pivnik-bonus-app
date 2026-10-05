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
| Rights/audit | Main gateway + disabled #174 routes | 107 auth/session/service/SQL checks | Tenant/store isolation unproven | Review approved store/tenant binding |

## Selected stage and updated composition

The original 54-check admission stage remains; it now executes the actual pinned
POS service instead of a service spy. Added 22 checks through the same signed HTTP
boundary, 11 per platform. No implementation bug confirmed; only diagnostic/report
changes. The owner workflow gains verification evidence, not new production behavior.
#203 release gate 1724 passed before this extension. Current main remains 18a0fa4.

`node scripts/verify-pos-session-boundary.mjs` reads exact #174 route blocks and ten
modules/DDL/fixtures from local git object 776c70d691540b01bbc56a1496203e6cc918eea6
into an OS temporary directory. No fetch/fallback or startup import. Current gateway
canonicalizeSessionToken/requireGatewayUser are extracted verbatim, asserted equal
to the pinned draft, and run with real main HMAC/session/effective-role helpers and
actual identity queries. Emits SHA256 for gateway boundary, routes and every module.

Original admission checks cover authorized dashboard/sync/link, repeated admission,
missing/forged/wrong-secret/expired/invalid/staff sessions, cross-provider identity,
revoked version, deleted/merged actor, outdated consent, viewer/client refusal,
permission before malformed-body parsing, malformed/oversized body and DB outage.
Denied admission invokes no service/provider and preserves POS documents, links,
sync state, wallets, transactions and identity snapshots. Deliberate fixture auth
changes apply only to actor 1. Signed platform cannot be overridden by an HTTP header.

Actual createPosService invokes existing sync/normalizer/import transaction SQL,
QR resolver/link repository, dashboard SQL and analytics. Local provider sends one
10-ruble receipt. Cash remains 1000 cents; loyalty becomes 1000 only after explicit
QR link to customer 2. Exact replay retains the entire original confirmation.
Conflicting customer, invalid input and unknown QR leave state unchanged.
A temporary CHECK constraint in disposable pos_customer_links forces an actual SQL
error: the service rolls back; removing the constraint allows the original command.

COMMIT followed by a deliberately truncated complete HTTP 200 body leaves one link
with actor 1 and time. JSON decoding fails. Revoked session on manual retry returns
401 and preserves the committed row; restored version retries the original body,
returns customer 2 and preserves all financial/audit state. This is direct HTTP
verification, not application API/browser recovery. Provider HTTP 401 is mapped by
existing Evotor client to 502; old cash/loyalty and link audit remain unchanged while
sync error state changes to error. All three fixture wallets and empty application
journal remain unchanged. Both platforms use the same fixture actor 1; this does
not establish real identity/account separation.

## Validation and boundaries

107/107 checks on canonical and materialized gateway sources; equal boundary/module
hashes. Full materialized node --test: 436/436. Two materializations identical across
395 tracked files; npm run check and diff-check pass. npm audit retains three existing
moderate qs/body-parser/express findings (exit 1). Generated runtime files restored.
No server route implementation change: server.js/universal-server.js final diff empty.
No UI change, therefore desktop/mobile testing not applicable to this extension.
Fresh public probe initially had eight Telegram timeouts; one bounded repeat
passed 16/16. Cause not established.
Authenticated production operations and business data were not queried.

Provider authentication now runs original local authenticateVk/authenticateTelegram,
validate wrappers, resolveProviderUser, canonicalUserId, ensureAuthRecords and
createSession, with real platform-core HMAC validators and account SQL. A minimal
/fixture/auth HTTP adapter calls those functions directly; it is not the complete
production auth dispatcher. Original 76 checks retained; 31 new auth/issuance checks.

Signed fixture launches create independent TG/VK owner actors, canonical repeated
login does not duplicate actors, issued sessions require consent then admit POS,
version revocation rejects the old token and re-auth issues current version.
Signed non-owners remain clients and receive POS refusal after fixture consent.
Missing/forged/expired/demo-disabled inputs reject before DB; VK unsigned profile
ID mismatch rejects. DB outage and actual wallet CHECK constraint failure leave
actor/identity/wallet/loyalty/journal/POS snapshots unchanged after rollback.
Existing wallet balances stay unchanged; newly provisioned wallets are zero and
application journal remains empty. Fixture consent is a direct disposable SQL
change; real consent endpoint not tested.

Materialized authentication invokes the existing optional tester-gift claim, unlike
canonical auth. The original function SQL from migration 008 and original table
DDL from 007 execute against an empty recipient table, without seeding actual
handles/gifts. Initial materialized harness failed on the missing function; adding
this required isolated schema resolved it. This was a fixture gap, not a confirmed
production regression. Auth source hashes intentionally differ canonical/materialized
and are emitted separately. Gift-recipient/award path remains untested.

Fixture base DDL/secrets, rowCount mapping, HTTP/body/error adapters and local
provider remain. Profile assembly returns only actual DB id/role; deferred setup,
trace and rate-limit helpers are adapters. Thus complete startup, throttling, QR
setup and live identity provisioning are not verified. Advisory locks stubbed;
no independent PostgreSQL contention, tenant/business/store ownership proof or
real fiscal samples. Existing link audit has actor/time/object/client but no reason.

No production data, config, schema, dependencies, sends, merge/deploy or patch
retirement. #201/#202 and foreign dirty work remain separate. Next bounded stage: replace the auth rate-limit adapter with the existing real
limiter and verify repeated invalid launch requests fail before account writes. Production enablement still requires approved store/
business ownership and real fiscal samples; do not invent that mapping.

Prior #203 release gate 1725 passed. MODULE-MAP and open PRs rechecked; current
main unchanged, no applicable AGENTS, previous starter/knowledge context retained.

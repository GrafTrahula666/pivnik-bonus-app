# Invalid successful JSON response — 2026-10-05

Fresh main 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5. This branch starts directly
from that main, not from #201. Origin remotes/history/branches, open PRs, CI and
worktrees reviewed. Previous #201 release gate 1722 passed. MODULE-MAP read;
no AGENTS found. Prior starter/knowledge context retained. Foreign dirty assets
and detached Business files preserved. No foreign implementation imported.

| Function | Existing implementation | Evidence | Concrete gap | Next step |
|---|---|---|---|---|
| Cash/Evotor | Disabled #174 | #201 SQL + local HTTP | Provider samples/approved store absent | Controlled onboarding review |
| Dashboards | #174/#176 | Existing fixture cash proofs | Full Business venue mapping absent | Review existing adapter |
| CRM/Customer 360 | Main + #115/#96 | #196/#197 visibility evidence | Independent wallet ownership absent | Trusted membership/binding |
| Bonus corrections | Main + #193/#199 | SQL/recovery/refusal proofs | Signed production entry absent | Complete authorized entry |
| Telegram | Main store/retry | Existing suite | Live campaign untested | Isolated retry provider |
| Achievements/frames | Main + Business grants | Existing suite | Scoped grants unverified | Audited grant scenario |
| Rights/audit/API | Main shared API, disabled scope modules | Two reproduced invalid-JSON failures | Malformed HTTP 200 was accepted as {} | Fail closed before success |

## Reproduced bug and fix

Main fetchWithTimeout swallowed every JSON parse failure into {}. api() then
returned it for HTTP 200, so callers could treat an unreadable response as success.
Two VM tests executing actual main API helpers failed before the fix (ordinary
POST and POST with requestKey: missing expected rejection). Valid JSON and
non-JSON HTTP 403 control cases passed.

app.js now raises INVALID_RESPONSE with the successful HTTP status and a Russian
message asking to check the result before repeating. The existing retry policy
therefore does not automatically resubmit the POST, even with a request key.
Non-JSON unsuccessful responses retain the prior generic HTTP error/status.
No business write, route, authentication or server parity behavior changed.
The shared client API affects all its callers, so full materialized suite and
existing timeout coverage are retained.

## Browser/actual service evidence

Reused our manual #201 HTTP verifier, with pinned disabled #174 files read from
git 776c70d691540b01bbc56a1496203e6cc918eea6 into disposable temporary modules.
No automatic fetch/fallback or startup imports. It now extracts actual timeoutError,
fetchWithTimeout and api from local app.js and emits their SHA256 hash. No rewrite
of those functions in the diagnostic. Fixture constants/state/delay and minimal
HTML remain adapters. Original headers are checked for fixture token, platform and
version on browser API calls. Existing external Playwright/Chromium paths required;
no dependency installed. Optional final argv `vk` selects VK; default Telegram.

36 scenarios per platform at 390/1440 px cover cash/import/replay, anonymous
loyalty, provider errors, role/input/store refusal, explicit QR audit/conflict,
SQL rollback and uncertain confirmation recovery. Actual service.link commits;
local HTTP adapter deliberately returns truncated JSON with HTTP 200. Original
app API now rejects it; original POS UI retains the form and original document/QR.
Viewer retry refuses without changing saved row; restored admin repeats the same
body, recovers visible profile/loyalty and preserves the complete original row,
including actor/time. Wallet/journal unchanged. No automatic second POST during
unreadable response or native disabled-button double click.

This proves same-component manual recovery for this fixture. It does not prove
TCP timeout/loss, reload/tab-close recovery, signed production owner/tenant/store
binding, real fiscal formats/provider, full startup or independent PostgreSQL
contention. PGlite advisory locks stubbed. Actual API timeout implementation runs,
but timeout expiry is covered by existing unit tests, not this browser scenario.
Existing link audit has no operation reason. No premium-dark/full-shell UX claim.

## Validation and limits

Focused tests 4/4 after fix. Full suite/browser/materialization/check/audit and
read-only production probe results recorded after execution below. Generated
runtime changes are restored before committing; only the intended app.js change,
tests, manual verifier and this report are retained. No production DB/user/schema/
configuration changes, provider sends, merge, deployment or patch retirement.

Next bounded stage: signed transport/dispatcher boundary on isolated fixtures;
real owner/store onboarding remains blocked on independently approved identity
and verified fiscal sample data. Production remains unchanged until authorized
merge/deploy; this PR only proposes the shared client correction.

Completed validation: 440/440 materialized tests; 72 canonical and 72 materialized
browser scenarios (36 each VK/Telegram, 390/1440 px); identical API function hash
across all four runs; double materialize identical hashes for 396 tracked/new
files; npm check, explicit script syntax and diff-check passed. Audit: three
existing moderate findings. Public read-only probe: 16/16. No current failure.

# CHAT 02 / item 15: policy and integration acceptance gate (2026-11-03)

Status: **IN PROGRESS / NO MERGE / NO DEPLOY**. This is one read-only evidence checkpoint for CHAT 01, not authorization to change RBAC.

- Confirmed current origin/main: `d7cc395e651d124ad0373eec67dd48bdaba64705` (#439 merged, staging URL override guard). Earlier checkpoint #434 was based on `d51b15e`; its evidence is not current-main integration acceptance.
- Existing #420 remains open Draft at `b6bafe2ce6269b317e4f5f7fce516f200a7d871f`; #378 remains open with no written company-wide trusted-director versus venue-invitation scope decision. Do not invent an authorization policy.
- #434 exact-head Release Gate completed SUCCESS at `b95eb4fd40d728d967dea86b877c3a1431dd70a4`; this does not prove the stacked #420 tests pass on current main. The current-main commit workflow lookup returned no pull-request-triggered runs; **CI for current main is unverified here**, not green.
- CHAT 01 integration #424 is independently open; #438 and #439 have been merged by other agents. Do not touch their branches or release controls.
- `ops/MODULE-MAP.md` reviewed on main. No runtime, duplicated routes, migrations, patch chain, secrets, deployment, or production data touched. Thus server.js/universal-server.js parity remains unchanged in this PR.
- Installed `pivnik-preflight` skill/references not listed. No local checkout or local test execution. No live E2E, native PG integration test, or Railway write performed.

## Coordinator decision required

1. In #378, record explicit owner/CHAT 01 approved policy: retain legacy company-wide trusted-director Admin reads, or constrain by venue, including scope, affected routes and rollback.
2. Obtain independent review of #420 and its dependencies. Do not interpret successful isolated CI as combined acceptance.
3. Coordinate a separate combined candidate against current main, run signed HTTP/native PostgreSQL tests and required materialize ×2, node --test, check and audit. Treat skipped tests as skipped.

**Next exact step:** await written #378 decision and independent #420 review; remain on item 15, not 16. This Draft PR is the CHAT 01 handoff and should not be deployed.

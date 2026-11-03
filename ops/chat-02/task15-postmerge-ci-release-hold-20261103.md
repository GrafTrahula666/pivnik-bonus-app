# CHAT 02 · task 15 · post-merge CI acceptance and release HOLD

Date: 2026-11-03. **IN PROGRESS / REVIEW + POLICY DECISION REQUIRED / NO MERGE OR DEPLOY.**
This is one isolated documentation-only acceptance checkpoint. It does not modify authorization policy, tests, routes, migrations, secrets, production data, or another direction's branch.

## Verified exact references

- Current `origin/main` as exposed by GitHub branch API: `a0bf63762c0126c34329b46f88071f51f3122fc6` (merged commercial integration [#421](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/421)).
- Prior CHAT 02 [#423](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/423) remains Draft at `46965c53117a67c174c96b775c1d25f49b62c33e`. Its [exact-HEAD release gate 41547495894](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41547495894) is now **completed/success**. Double materialization, idempotency, syntax, Node tests, Business tests and audits passed in that CI job; production-only steps were **skipped**.
- The CHAT 02 [#420](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/420) stacked signed HTTP / PostgreSQL tests had **4/4 successful workflows** at `b6bafe2ce6269b317e4f5f7fce516f200a7d871f`, on the earlier integration boundary. Its test file is **not on current main**; earlier green results do not certify main's changed `admin-platform/server/router.ts`.
- The [main release gate 41545422468](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41545422468) is **completed/failure** at the exact main SHA. The failing job step is **Verify existing production secrets without changing them**. This is not an authorization-test failure, nor a release approval.
- Parallel P0 recovery is owned elsewhere: [#425](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/425) has 4/4 successful workflows including Admin server emission at `4abcfdd4cb99240adb78ca4a9765b0cfec2be201`; [#426](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/426) has a successful release gate at `53525f81d3e99e6a038087c94df95d57c77765ab`. Both remain separate **open/unmerged** PRs. Neither proves that current main or production is fixed.

## Authorization boundary and review gate

- Task 15 tests target **two venues in one company**. Onboarding draft/invitation grants are exact-venue scoped; company owner retains independent access. Legacy active Admin trusted-director reads remain company-wide by current design. Do not silently tighten them.
- [#378](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/378) has no recorded policy approval or review; [#420](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/420) has no independent submitted review. CHAT 01 must record a written A/B policy decision and reviewer before changing legacy RBAC.
- [CHAT 01 #385](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/385) and commercial integration [#424](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/424) are parallel Draft branches; no changes were made to them.
- `ops/MODULE-MAP.md` Do not break reviewed: preserve existing legacy roles, kiosk/release safeguards, server-side money semantics and double materialization. No `server.js` or `universal-server.js` route was changed, so route parity is unaffected by this checkpoint.

## Limitations, blockers and exact next step

- Installed `pivnik-preflight` and references were not available through the skill registry or local skill paths. No local checkout/test execution. The accessible Railway account project list did **not** expose the production project, so the final `admin-pilot` deployment state could **not** be freshly verified. No live E2E was performed.
- **Blockers:** explicit trusted-director venue-scope policy; independent #420 chain review; signed HTTP/native PG integration against current main/router; release coordinator's separate production CI and Railway GO/NO-GO.
- **Next exact step:** CHAT 01 obtains and records the legacy director policy A/B decision in #378 and an independent review of #420; then run combined signed HTTP/native PG regressions on a new-main integration candidate without touching production. Keep task **15 IN PROGRESS** and do not start task 16.

**Handoff:** this Draft PR description is the safe channel to CHAT 01. No merge, deploy, production write, secret edit, force push, or other-agent branch change.

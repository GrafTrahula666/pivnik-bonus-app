# CHAT 02 · task 15 · independent integration evidence checkpoint (2026-11-01)

**Status: IN PROGRESS / POLICY_REVIEW_REQUIRED.** This is an independent read-only review of the existing CHAT 01 integration candidate, **not** an additional test implementation, merge approval, or proof of production safety.

## Confirmed baseline and parallel ownership

- `origin/main` = `c92ed7cd65f1a96d94363c2b7e212424ab078a73` (verified via GitHub commit/compare; unchanged).
- CHAT 01 has already prepared combined **Draft PR #382**, head `96ccd5f76c48e86bd034f82da46f32d2f8cb1838`, based on main. Its four changed paths are **three existing CHAT 02 test files** from #372/#375/#379 and the disposable PostgreSQL workflow. No runtime routes, SQL migrations, secrets, production DB or kiosk files.
- CHAT 02 source Drafts #372, #375, #378, #379 remain separate; #380 was merged **into #379's branch**, not main. Do not reapply, overwrite, or independently merge these stacks.
- CHAT 01 commercial checkpoint #363 and other chat branches remain separate. No change in this PR to any of them.
- `ops/MODULE-MAP.md` Do not break reviewed: onboarding invitation grants are venue/draft-scoped, whereas existing active Admin `resolveVenueScope` / `requireVenueAccess` permit a trusted director's allowed operations across a company's active venues. Do **not** silently convert legacy company-wide rights into per-venue rights.

## Exact-head verification of #382

GitHub Actions for `96ccd5f7` were independently inspected (workflow runs, job steps and logs):

| Evidence | Observed result | Boundary |
| --- | --- | --- |
| [Release gate #41292383251](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41292383251) | SUCCESS; materialize twice/idempotence, root Node **606/606**, Business **656 passed / 90 skipped**, checks and high-threshold audit passed | Skipped tests are not successful tests; production checks/deploy intentionally skipped |
| [Disposable native PostgreSQL #41292383234](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41292383234) | SUCCESS; bootstrap **29/29**, signed draft/support HTTP **5/5**, signed progress HTTP **1/1** | Loopback PostgreSQL 16 fixture, **not** production/live E2E |
| [Inventory native PostgreSQL #41292383223](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41292383223) | SUCCESS | Separate inventory regression, not venue-grant E2E |
| [Business browser #41292383249](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41292383249) | SUCCESS | Synthetic desktop/mobile fixtures, not live venue E2E |
| Independent PR reviews | **0** on #382 at inspection | Approval still required |

The five predicate grant tests in `chat02-same-company-venue-grants.spec.ts` run under **PGlite**, not native PostgreSQL. Native PostgreSQL directly executes the two signed HTTP suites (5+1), not that predicate-only file as an independent native step. Dependency audit reported **12 moderate** Business and **1 moderate** root production advisory; the high-severity threshold passed. Do not describe the entire 11-test set as native PostgreSQL.

## Remaining decision / precise next step for CHAT 01

1. Decide and document **A:** keep the current company-wide trusted-director permissions on legacy active-venue routes while enforcing exact invitations on onboarding; or **B:** authorize a separate, explicit legacy per-venue RBAC contract, requiring its own runtime change and tests. #378 describes this distinction.
2. Obtain independent review of #382 and source PRs, confirm that the selected policy and route coverage meet task 15's acceptance criteria. The combined test CI is green but does not itself resolve the product policy.
3. Before any eventual main merge, independently verify Railway deploy protection (reported `source.checkSuites=false` on live services), GitHub Railway authorization (prior `Not Authorized`), rollback and a protected release window. **Do not merge/deploy from this checkpoint.**
4. If policy/acceptance remains unresolved, continue **task 15**, not task 16. Only after task 15 is accepted may CHAT 02 move to #16.

## Execution limitations and safety

Installed skills registry returned **zero skills**; `pivnik-preflight` and its references could not be loaded. No local checkout, local `npm run materialize` ×2, `node --test`, `npm run check`, `npm audit`, focused Vitest, or live E2E was performed **in this checkpoint**; the successful commands above were observed in exact-head GitHub CI. Railway was not accessed because no production-state operation is needed to review the isolated synthetic tests. No runtime code, server.js/universal-server.js routes, production data, secrets, other branches, force push, merge or deploy touched.

**Next exact step:** CHAT 01 independent reviewer records policy A/B and a review disposition on #382; CHAT 02 then either closes #15 as reviewed or adds one explicitly approved missing negative regression in a separate Draft PR.

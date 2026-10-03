# Business / root test runner isolation — 2026-10-03

Base: fresh `origin/main` `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`.
New clean worktree and branch `fix/admin-test-runner-isolation-20261003` started
at exactly that SHA. Read MODULE-MAP.md; no applicable AGENTS.md found.
The starter pack and SaaS knowledge base were read in the preceding stage;
their workflow, safety and verification requirements remain applicable.

## Confirmed problem

PR #176 is still draft, head `2f98f39d687043639d90b99352dcc0b15eb04c81`,
base `admin-platform/production-pilot` (not main). Its release-gate run
https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37028411866
fails at automated tests. Retrieved job logs show 10 Business `.test.ts`
files executed by root `node --test`, with `ERR_MODULE_NOT_FOUND: vitest`.
Installing Vitest alone does not fix the incompatible runner: isolated
reproduction after installing both packages still has 136 passes / 10 failures.
Business has its own package.json, lockfile and Vite/Vitest configuration.

PR #180 dependency fix remains separate, unmerged; its release gate has now
succeeded: https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37085123340.

## Existing functionality / concrete gaps

| Function | Existing implementation | Verified here | Gap | Next step |
| --- | --- | --- | --- | --- |
| Evotor importer | Origin branch / draft #174 | Branch remains present; prior CI evidence preserved | Real cash acceptance absent | Test one authorized sandbox sale/return |
| Cash and loyalty dashboards | Draft #176, separate Business branch | 52 Vitest tests, typecheck and build pass | Release gate mixes runners; venue adapter still absent | Apply runner fix after review; adapter as separate stage |
| CRM / Customer 360 | Main directory, Customer 360 origin branches, Business clients | Main full suite; Business unit suite | No authenticated owner acceptance | Verify one read-only client history |
| Telegram broadcast | Main campaign store, preview/send, retry origin branches | Main campaign/authorization regression suite | No real test delivery | Test preview and a single authorized message |
| Bonuses / achievements / frames | Main persistence/catalog, Business mutation routes | Main regression suite; Business unit tests | 14 Business PostgreSQL integration tests skipped | Use dedicated disposable test DB in a separate stage |
| Audit / permissions | Main authorization and Business tenant/audit modules | Main and Business unit tests | Production owner/tenant workflow not verified | Cross-tenant integration acceptance |

No existing feature was recreated. No other branch's implementation was
merged into this branch. #176 was checked in a separate detached worktree.

## Change and owner benefit

Root `npm test` now runs `scripts/run-root-tests.mjs`: recursively discovers
Node `.test.js/.test.mjs/.test.cjs` files under `test/` only and executes them
with the installed Node binary. It preserves nested tests, forwarded CLI
flags, failure exit codes and fails on an empty/missing suite. It does not
load files from separately managed packages.

A separate `Business tests and build` workflow runs on PRs and main pushes.
When Business exists, it installs its exact lockfile and requires Vitest,
typecheck, frontend/backend build and production dependency audit. A partial
package fails instead of silently skipping. Main currently has no Business
package; the job explicitly reports absence. No PostgreSQL service or
production credentials are supplied; database integration tests may skip.

This prepares a reliable review gate for the existing cash panel so code is
checked by its intended runner. It does not yet connect the owner's cash
register or make #176 green: these changes must first reach that branch after
review. Existing root release-gate production actions are unchanged.

## Verification

- Main: double `npm run materialize`, identical tracked-file SHA-256 manifests.
- Required unrestricted `node --test`: 439/439, 0 fail/skip.
- New `npm test`: 439/439; exact same passing test names as unrestricted run.
- Three new runner tests: nested discovery and package exclusion, propagated
  failures, missing/empty suite rejection. No test files were dropped.
- `npm run check`, changed runner syntax and VK startup parity pass.
- #176 detached snapshot: isolated root runner 136/136; Vitest 52 passed,
  14 PostgreSQL tests skipped. Typecheck and frontend/backend build pass.
- A temporary failing Business test returns exit 1 and is removed afterwards.
- Workflow YAML parses. Its detection step passes absent/complete package
  fixtures and rejects a partial package; no continue-on-error on test steps.
- Full root audit: 3 pre-existing moderate entries, addressed separately in
  #180. Full Business audit: 2 moderate / 3 high pre-existing dev dependency
  entries. Business production audit: 0 vulnerabilities. No lockfile change.
- Public read-only VK/TG probe: 16/16 reachable responses.

No routes or UI changed; desktop/mobile UI testing is not part of this stage.
Canonical server.js/universal-server.js unchanged; no route parity delta.
Generated materialized outputs restored before commit. No merge, production
deploy, production DB write/migration or broadcast.

## Remaining limits / next stage

No authenticated owner browser session or real cash credentials. No claim
that skipped integration tests passed. A workflow added on main cannot run on
the unchanged #176 branch until explicitly incorporated there after review.
Next small step: review this runner PR, then carry its isolated changes into
the Business branch and inspect that branch's complete CI result. Existing
Business dependency warnings and the venue POS adapter remain separate tasks.

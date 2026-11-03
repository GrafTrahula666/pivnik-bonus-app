# CHAT 02 / task 15: exact-head CI acceptance (2026-11-03)

Status: **IN PROGRESS / POLICY HOLD / NO MERGE OR DEPLOY**.

- Latest previous checkpoint: Draft #428, branch `docs/chat02-15-postmerge-ci-release-hold-20261103`, head `662214ca53c088a90c931b3a2c97ff71eb7e2e50`.
- GitHub Actions on that **exact** head: [Pivnik release gate run 41555063897](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41555063897) = **completed / success**. This is a PR-only gate, not a production release authorization; skipped production/live checks are not passes.
- GitHub compare confirms current `main` remains `a0bf63762c0126c34329b46f88071f51f3122fc6` at inspection. Its [main release gate run 41545422468](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41545422468) failed at Railway production secret read authorization, according to prior verified checkpoint. The successful #428 PR gate does not cure that main failure.
- Earlier [#420](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/420) had 4/4 successful fixture CI on `b6bafe2ce6269b317e4f5f7fce516f200a7d871f`, but this is **not** a combined new-main signed HTTP/native PG validation.
- [#378](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/378): explicit owner/CHAT 01 decision needed whether legacy trusted director keeps company-wide access for permitted methods, unlike invitation-scoped onboarding. Do not infer global venue isolation from onboarding tests.
- CHAT 01 integration #424 and remediation Drafts #425/#426 remain parallel work; do not modify or merge them. Read `ops/MODULE-MAP.md` Do not break before this docs-only checkpoint. No root server routes touched, so `server.js`/`universal-server.js` parity is unchanged.
- Installed skill registry returned no `pivnik-preflight` or references. Local checkout/tests unavailable in this run; live E2E not run. No Railway writes or deploys.

**Next exact step:** CHAT 01/owner records written A/B policy decision and approver in #378, obtains independent review of #420 chain, and arranges combined signed HTTP/native PostgreSQL tests against current main/router. Do not close #15 or start #16 until those gates are met.

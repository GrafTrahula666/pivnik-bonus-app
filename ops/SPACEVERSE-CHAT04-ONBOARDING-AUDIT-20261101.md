# SPACEVERSE Chat 04 — checkpoint 31: onboarding workflow audit

Date: **2026-11-01**. Scope: Chat 04 only (items 31–40). Mode: isolated Draft PR, **no production writes, secrets, merge or deployment**. Audit is based on read-only GitHub/Railway inspections. It is not a live proof of CRM activation.

## Checkpoint

- **Task:** 31 — audit existing onboarding wizard and status transitions.
- **Status:** **SOURCE AUDIT COMPLETE**; no runtime tests were executed during this session. The next isolated task is **32**, after coordinator review.
- **Base:** `origin/main@c92ed7cd65f1a96d94363c2b7e212424ab078a73` (read from GitHub on 2026-11-01).
- **Branch:** `spaceverse/chat04-onboarding-audit-20261101`. This document is the only intended change. Draft PR/HEAD commit are authoritative on GitHub, not copied into a self-referential file.
- **Existing related merged work:** [#273](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/273) (original wizard, canonical scope, encrypted POS, provisioning), [#296](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/296) (isolated empty CRM DB bootstrap). No open PR with an onboarding title appeared in the 56 open PRs reviewed on 2026-11-01. This does not prove no other agent is working elsewhere.
- **Other origin branches inspected by index:** `spaceverse/venue-onboarding`, `spaceverse/crm-onboarding-support-20261019`, `spaceverse/crm-activation-check-20261019`, `spaceverse/crm-empty-database-bootstrap-20261020`. The merged canonical implementation on main is the source of truth for this audit; avoid importing stale draft modules.

## Status model: verified in source, not in production

The existing `admin-platform/server/onboarding-workflow.ts` defines **eight steps**, in order: `organization`, `venue`, `application`, `provider`, `terminal`, `modules`, `provisioning`, `verification`. Each step reports one of seven states:

| State | Current server interpretation | Important limitation |
| --- | --- | --- |
| `not_configured` | Required scope/setting/device information absent | Not an error or proof of an outage |
| `pending` | Saved/prepared/unverified, or waiting for next prerequisite | A created venue / saved terminal / completed bundle is not launched |
| `verifying` | Provisioning operation has a current server lease | Not active; expired leases become degraded |
| `active` | An **individual** evidence-backed step succeeded, e.g. fresh provider documents or verified POS proxy | Does **not** imply whole tenant, runtime or CRM activation |
| `degraded` | Stale provider evidence, lost lease, previously verified provider now failing | Requires recheck/reconciliation; do not assume a valid connection |
| `suspended` | Modules explicitly disabled in saved configuration | No implicit enablement |
| `failed` | Negative provider/provisioning result or inconsistent active venue | No automatic retry-as-success |

The **aggregate** workflow returned by `view()` is `failed/degraded/verifying/pending`, not `active`. It always exposes `requiresAttention:true`, `runtimeStatus:'not_provisioned'`, `published:false`. A prepared venue remains inactive. Provider document reads and proxy link evidence are separately scoped. Individual `active` step labels must not be used as a SaaS activation signal.

Relevant sources:
- [server/onboarding-workflow.ts lines 11–14, 96–185](https://github.com/GrafTrahula666/pivnik-bonus-app/blob/c92ed7cd65f1a96d94363c2b7e212424ab078a73/admin-platform/server/onboarding-workflow.ts#L11-L185): exact status calculations, lease, provider freshness and aggregate.
- [server/venue-onboarding.ts lines 252–299](https://github.com/GrafTrahula666/pivnik-bonus-app/blob/c92ed7cd65f1a96d94363c2b7e212424ab078a73/admin-platform/server/venue-onboarding.ts#L252-L299): inactive canonical scope and not_provisioned contract.
- [server/onboarding-venues.ts lines 14–87](https://github.com/GrafTrahula666/pivnik-bonus-app/blob/c92ed7cd65f1a96d94363c2b7e212424ab078a73/admin-platform/server/onboarding-venues.ts#L14-L87): legacy venues with unknown connection, CRM activation summary, scope-aware status.
- [src/phaseC/OnboardingProgress.tsx lines 4–69](https://github.com/GrafTrahula666/pivnik-bonus-app/blob/c92ed7cd65f1a96d94363c2b7e212424ab078a73/admin-platform/src/phaseC/OnboardingProgress.tsx#L4-L69): eight-step rendering and rejection of inconsistent server responses.
- [src/phaseC/OnboardingPosProxy.tsx lines 4–75](https://github.com/GrafTrahula666/pivnik-bonus-app/blob/c92ed7cd65f1a96d94363c2b7e212424ab078a73/admin-platform/src/phaseC/OnboardingPosProxy.tsx#L4-L75): proxy activation requires a report and device evidence.

## Existing guardrails and functional boundaries

1. **Server-owned truth.** Persisting `currentStep`, terminal display ID and module preferences does not write a fake active state. `saveOnboardingWorkflow` uses a transaction, protected scope, revision/replay check and audit event; the UI does not submit arbitrary status.
2. **No invented financial result.** Until verified connection, `report.state='unavailable'`, `netCents=null`, `receiptCount=null`. Old canonical active rows without verified connection show pending/unknown. Thus `unknown !== 0`.
3. **Access.** `onboarding-access.ts` uses company ownership, invite grant and per-draft role scope; writes additionally require owner/manager. A viewer can inspect its allowed draft without being granted writes; foreign draft IDs fail closed.
4. **Secrets.** Provider and proxy UI exposes masked credentials, with separate storage/verification; URL/target database credentials are server-only. Do not merge/replace encrypted storage while working on task 32.
5. **Feature gates.** In `server/config.ts` the onboarding drafts, workflow, integrations, provisioning, CRM onboarding and CRM activation checks are **false by default**. A source-code implementation is not evidence that it is enabled on production.
6. **Provisioning is intentionally incomplete.** Binding/schema/bundle evidence is not runtime launch, registered licensing or Market contract. PR #296 added guarded empty database bootstrap, not automatic commercial activation.

## Existing tests reviewed as source

- `admin-platform/server/tests/onboarding-workflow.spec.ts`: eight-step status transitions; stale provider; provider denied; schema/lease/bundle pending; foreign scope; unauthorized viewer mutation; status spoofing; CSRF; audit rollback; preserving unknown revenue.
- `admin-platform/server/tests/venue-onboarding.spec.ts`: draft idempotency and conflict; creator isolation; preparing inactive scope; no wallet/customer writes on draft saves.
- `admin-platform/src/phaseC/OnboardingProgress.tsx`: response validation and in-flight/replay behavior.
- `admin-platform/e2e/venue-onboarding.spec.ts`, `admin-platform/playwright.onboarding.config.ts`: browser fixture coverage is present. Running tests was **not** possible without a checked-out repository and dependencies.

**Not executed in this session:** `npm run materialize` twice, `node --test`, `npm run check`, `npm audit`, Business test/build, real mobile browser, live signed HTTP/session, live PostgreSQL, Evotor or real tenant activation. Historical PR test reports and current commit status checks cannot be substituted for these runs.

## Read-only infrastructure check

- GitHub `main` head at review: `c92ed7cd65f1a96d94363c2b7e212424ab078a73`. The combined status endpoint returned success for three Railway content-nature contexts, but no matching pull_request workflow runs; this is not a full CI gate result.
- Railway project `content-nature`, production environment: `admin-pilot` source repo `GrafTrahula666/pivnik-bonus-app`, branch `main`; latest listed deployment `SUCCESS` created 2026-10-29 08:51 UTC. `pivnik-bonus-app` source branch `main`; latest listed deployment `SUCCESS` created 2026-11-01 00:37 UTC.
- No value of a production environment variable was fetched. Therefore the onboarding feature-flag states **in production remain UNKNOWN**, as does exact deployed commit hash for admin-pilot and any real customer or provider linkage. No production DB read or mutation was performed.
- `ops/MODULE-MAP.md` current `Do not break` section starts around line 1282. Never weaken materialize idempotency, migration 007 preservation, QR alias semantics, HTML escaping, Telegram timeouts, broadcast dedup, VK/TG identity separation, server-side wheel odds, staff bonus limits or VK bundle hygiene.

## Assessment and next isolated action

**No verified P0 security regression identified by source review.** Important **P1 product-interpretation risk**: a step may have the label `active` / «Подтверждено» for provider or POS while the whole venue is **not** active. This appears intentionally handled in aggregate status; do not claim it is a bug without browser and signed-HTTP proof.

**Task 32:** inventory the actual wizard's multiple sections and check how users navigate the one canonical data flow. Reuse `VenueOnboarding`, `OnboardingProgress`, existing secret storage and server responses. Design a minimal, reversible UX consolidation, no second wizard, no duplicated keys, no auth/tenant/backend schema changes unless a specific verified gap requires a separate PR. Preserve all current functionality, errors, recovery and touch actions. Before implementation re-read changed main/PR/CI and rerun the test gates in a checkout; no live activation by UI click.

**Handoff:** Chat 01 release coordinator should review this documentation-only Draft PR. Do **not** merge/deploy this branch automatically. If source moves, revalidate before starting task 32.

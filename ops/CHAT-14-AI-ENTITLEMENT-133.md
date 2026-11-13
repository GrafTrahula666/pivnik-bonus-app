# SPACEVERSE / CHAT 14 / 133 — Independent AI entitlement checkpoint

**Scope:** add a separate, default-off AI add-on entitlement foundation. **Not** an AI provider, subscription purchase, activation flow, AI chat endpoint or commercial rollout. Work is staged in an independent Draft branch; no merge/deploy.

**Branch:** `spaceverse/chat14-ai-entitlement-133-20261101` · **Draft PR:** [#356](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/356) · **initial commit:** `65a31cf3c6bb5e2e43f2168fdd9819a393486bdf` · **PR creation HEAD:** `417eb9d9f01f04aeb8fcb1fe915e36fe5e49ecd7`. Actual latest HEAD and CI must be checked after each update.

## Verified basis (2026-11-01)

- Checked `main c92ed7cd65f1a96d94363c2b7e212424ab078a73` and `ops/MODULE-MAP.md` / Do not break. No patch-chain, fiscal, kiosk or auth route modifications.
- Existing `admin-platform/server/auth.ts:loadSession` supplies an authenticated principal; `tenant.ts:resolveVenueScope` supplies canonical company+venue. Future AI endpoints **must** use both, then invoke `requireAiEntitlement` for each call.
- Existing company permission is owner/trusted; **trusted access to GET pos does not grant AI**.
- Admin schema migrations are manually gated by `ADMIN_ALLOW_MIGRATIONS` (`admin-platform/server/migrate.ts`). Current main ends at `026_beer_inventory_ledger.sql`, and this PR introduces next numbered additive `027_ai_entitlements.sql` **but does not apply it**.
- CHAT 14 / 132 [Draft #352](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/352) is a **specification** for aggregate tools; exact HEAD `251f5e618ca23a5abcda4275141088cc797b39fe` passed [Release Gate #2342](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268707181), pending coordinator review.
- CHAT 14 / 131 [Draft #341](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/341) independently passed CI, pending coordinator review. This 133 branch is based on `main`, **not** either draft.

## Changes within 133

1. `admin-platform/admin-migrations/027_ai_entitlements.sql`: venue-scoped metadata table; defaults `state='not_configured'`, `enabled=FALSE`, contains **no activation rows**. Explicit activation requires active state, approval timestamp/reference and future expiry, checked at DB level. Separate from CRM/Evotor licensing and `admin_customer_entitlements` (guest rewards). Manual migration only.
2. `admin-platform/server/config.ts`: new `ADMIN_ENABLE_AI` flag defaults to false. Both `.env.example` and `env.example` document the same default-off switch. This alone never grants AI.
3. `admin-platform/server/ai-entitlement.ts`: read-only, deny-by-default guard checks live active company, venue, admin, role and owner access from the canonical metadata DB, then checks exact venue entitlement. SUPER_ADMIN may select a venue but has **no bypass** of the entitlement or global flag. Trusted director denied. A missing table, row, expiry, permission or DB error always denies. No SQL/PII/provider keys exposed to AI.
4. `admin-platform/server/tests/ai-entitlement.spec.ts`: disposable PGlite exercises exact migration, flag off, default false, explicit approval, owner, trusted director, other company/venue, malformed scope, role revoke, expiry, suspended state and DB failures.

## Important limits / security

- **No HTTP route added:** there is no currently active AI endpoint, so this guard cannot yet authorize a real AI request. Future route must call `loadSession`, `resolveVenueScope` and `requireAiEntitlement` **on every tool invocation**, plus a separate metric permission, budgets and provider controls.
- **No paid activation:** the migration must not be applied to production in this PR. Operators must NOT manually grant AI paid entitlements or switch on `ADMIN_ENABLE_AI` until provider, cost, usage, security and rollback approvals in point 140. This code does not supply those approvals.
- **No broad plan activation:** even CRM subscribers and SUPER_ADMIN default to AI disabled when the per-venue record/flag is absent.
- **Not a billing system:** `approval_reference` is a schema guard, not third-party proof of payment. A future controlled entitlement writer and audit trail require a separate reviewed implementation.
- No update to `server.js` or `universal-server.js`. No touched runtime financial code, loyalty features, stock, deployments, secrets, real kiosk or production data.

## Verification and next

- Verify branch diff, file read-back, full GitHub Release Gate on exact HEAD and coordinator review before considering merge. Local working repo is not mounted; no local npm/materialize/Vitest/audit claims.
- This point **133** can be called technically prepared only after its tests/CI pass. Handoff to CHAT 01; keep Draft / NO MERGE / NO DEPLOY.
- Next task **134** (honestly labelled synthetic/mock preview, no external API) is a separate task and separate branch; do not begin if 133 CI has unresolved failures.
- Hourly CHAT14 automation could not be created earlier because account already had 5/5 active schedules. Do not disable unrelated tasks without permission.

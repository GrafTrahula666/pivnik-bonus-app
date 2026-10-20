# Next stage — safe write operations plan

Write operations remain disabled in this package.

The order below is intentional.

## Gate 0 — before any write

Required evidence:
- production DB backup/rollback procedure confirmed;
- Admin migrations applied to staging first;
- real read-only PIVNIK dashboards verified against known production values;
- tenant security integration tests pass against PostgreSQL;
- production reader is a SELECT-only DB role;
- no customer service imports/calls Admin Platform;
- browser console/network smoke passes.

## Gate 1 — Admin-owned configuration only

Start with settings that do not mutate customer ledger:

1. create/edit `venue_settings`;
2. create/edit `loyalty_levels`;
3. create/edit `wheel_configs` / `wheel_prizes`;
4. create/edit achievement configuration;
5. create/edit shop configuration;
6. create/edit promotions.

Every mutation:
- requires authenticated server-side tenant scope;
- ignores browser-supplied company ownership;
- uses transaction;
- records old/new JSON in `admin_audit_log`;
- validates invariants before commit;
- uses CSRF and Origin checks;
- uses an idempotency key where repeated submission can be harmful.

Do not make VK/TG consume these tables yet.

## Gate 2 — customer runtime fallback adapters

Introduce one read adapter at a time to the existing customer backend.

Pattern:

```text
value = validate(database_setting)
  ? database_setting
  : LEGACY_CONSTANT
```

Examples:
- base cashback;
- welcome bonus;
- loyalty levels;
- wheel enabled/cooldown;
- shop enabled;
- achievements enabled.

Each adapter needs:
- unit test for valid DB value;
- unit test for missing row;
- unit test for invalid row;
- legacy-equivalence test;
- rollback test with Admin service completely unavailable.

The customer runtime reads the database directly. It must never call the Admin HTTP service.

## Gate 3 — financial/customer actions

Only after the configuration path is stable.

### Add/subtract bonus

Do not directly update `wallets` alone.

Use a dedicated production-domain service/transaction that:
- locks the user/wallet;
- validates tenant membership;
- writes an idempotent `transactions` ledger row;
- changes balance atomically;
- writes Admin audit referencing the ledger transaction.

Before this stage, add explicit `venue_id` attribution to the financial ledger or an equivalent immutable mapping.

### Individual cashback

Store tenant-owned override with:
- venue_id;
- user_id;
- value;
- reason;
- created/updated by;
- validity interval if needed.

Customer runtime:
DB override if valid → existing loyalty status fallback.

### Grant achievement/frame/item

Reuse the existing durable production grant patterns instead of setting presentation flags only.

Each grant must be:
- idempotent;
- tenant-scoped;
- auditable;
- reversible only where product rules permit.

## Gate 4 — publish constructors

### Wheel

Before publish:
- enabled probabilities sum exactly 10000 basis points;
- all reward payloads valid;
- stock/limits non-negative;
- no impossible cooldown/retry cost.

Publish should be a versioned config snapshot, not partial row-by-row live mutation.

### Loyalty

Validate:
- thresholds strictly increasing;
- cashback/discount within allowed range;
- no overlapping invalid bands.

### Shop / Promotions / Achievements

Use immutable/versioned publication state where practical.

## Gate 5 — second real tenant

Do **not** enable a second company on the legacy PIVNIK ledger adapter.

First add explicit tenant attribution to:
- transactions;
- wheel events;
- shop purchase events;
- achievement events;
- analytics events.

Then test one customer belonging to two venues/companies and prove that each tenant receives only its own rows.

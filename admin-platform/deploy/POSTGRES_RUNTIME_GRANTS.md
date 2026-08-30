# PostgreSQL runtime roles for Admin Platform

This is a **manual deployment preparation document**. Nothing here is executed automatically.

For production, use two database users/connections.

## 1. Admin metadata writer

`ADMIN_DATABASE_URL`

This account needs CRUD only on Admin Platform-owned objects:

- companies
- venues
- admin_accounts
- admin_company_access
- admin_sessions
- admin_audit_log
- venue_settings
- loyalty_levels
- wheel_configs
- wheel_prizes
- achievement_configs
- shop_item_configs
- promotion_configs
- admin_schema_migrations

It needs `SELECT` on `bars` during the explicit PIVNIK mapping migration.

It does **not** need UPDATE/DELETE/INSERT on:

- users
- wallets
- transactions
- user_identities
- bar_customers
- beer_loyalty
- user_achievements_v2
- wheel_spins
- shop_items
- shop_purchases
- promotions
- app_settings

## 2. Production reader

`ADMIN_READ_DATABASE_URL`

Give this database role:

- `SELECT` on the relevant production tables listed above;
- `SELECT` on Admin `companies` and `venues` so read queries can resolve mapped tenants;
- **no INSERT / UPDATE / DELETE / TRUNCATE / DDL privileges**.

The Node read pool also starts with:

```text
default_transaction_read_only=on
```

so the application has two independent safety layers:
1. PostgreSQL grants;
2. connection-level read-only mode.

## Important tenant rule

Current legacy financial tables are user-centric and `transactions` has no `bar_id` / `venue_id`.
Therefore the legacy adapter is hard-gated to `company.code = 'pivnik'`.

Do not enable legacy ledger reads for a second tenant until transactions/events have explicit venue attribution.

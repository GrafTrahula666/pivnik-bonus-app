# CODEX Admin Platform — Phase B architecture

Status: **implemented as a production-schema-grounded, read-only integration package, but not connected/deployed to the production database in this workspace. Do not call Phase B complete yet.**

## 1. Production architecture that was inspected

Source repository:

`https://github.com/GrafTrahula666/pivnik-bonus-app`

Inspected branch: `main`, 2026-08-29.

Observed production boot path:

```text
Railway
  -> npm start
  -> universal-server.js
       -> public gateway on $PORT
       -> spawns server.js on internal PIVNIK_INTERNAL_PORT
       -> waits for child /api/health
       -> serves VK/TG documents and gateway API
  -> PostgreSQL through DATABASE_URL
```

The repository Railway config starts `npm start` and checks `/api/health`.

Important current legacy facts:

- `BAR_CODE = 'pivnik'`
- `BAR_NAME = 'ПИВНИК'`
- address is still a production constant
- `STATUS_LEVELS` is still a production constant
- `PLATFORM_ACCOUNT_MODE = 'separate'`
- account-linking requests are disabled by the gateway
- wheel runtime is currently exposed to Telegram only
- `users`, `wallets`, `transactions`, `beer_loyalty`, `app_settings`, `promotions`, `shop_items` are created/maintained by the current backend
- migrations add `bars`, `bar_customers`, `user_identities`, `wheel_spins`, `user_achievements_v2`, `shop_purchases`, and other RED COSMOS structures
- `transactions` is user-centric and has **no `bar_id` / `venue_id`**

That last point is important for real multi-tenancy: a transaction cannot safely be attributed to a second tenant solely because the customer appears in `bar_customers`.

## 2. Admin service boundary

The new service remains:

```text
VK / Telegram Mini Apps
    -> existing universal-server.js / server.js
    -> existing DATABASE_URL / production DB

Admin Platform
    -> separate server/index.ts
    -> /api/admin/*
    -> ADMIN_DATABASE_URL               (Admin-owned metadata/session/audit writes)
    -> ADMIN_READ_DATABASE_URL          (SELECT-only production reader)
    -> same PostgreSQL database
```

There is no call from VK/TG boot/auth/QR/bonus/wheel/shop code into the Admin service.

The Admin service has its own:
- process entrypoint;
- health endpoint;
- auth session store;
- CSRF policy;
- login rate limit;
- audit table;
- tenant mapping;
- deployment config.

Admin outage therefore does not participate in the customer runtime dependency graph.

## 3. Multi-tenant model

New additive model:

```text
companies
  -> venues
       -> legacy_bar_id (optional mapping to existing bars.id)

admin_accounts
  -> admin_company_access

admin_sessions
admin_audit_log
```

Roles are intentionally only:

- `SUPER_ADMIN`
- `VENUE_ADMIN`

A venue admin is authorized through `admin_company_access` using the authenticated admin id from the server-side session.

The browser never grants itself company access by sending `company_id`.

### PIVNIK mapping

Migration `admin-migrations/001_admin_core.sql`:

1. upserts company `code='pivnik'`;
2. reads the existing `bars` row where `bars.code='pivnik'`;
3. creates/updates one `venues` row with `legacy_bar_id = bars.id`.

It does **not** copy:
- users;
- user identities;
- bar customers;
- wallets;
- transactions;
- achievements;
- wheel spins.

The production records remain canonical.

## 4. Tenant isolation

Every `/api/admin/venues/:venueId/*` request first calls the server-side tenant resolver.

For `VENUE_ADMIN` the resolver requires:

```sql
EXISTS (
  SELECT 1
  FROM admin_company_access aca
  WHERE aca.company_id = v.company_id
    AND aca.admin_id = $authenticated_admin_id
)
```

The venue id is parsed as a positive integer before SQL.

Then each legacy PIVNIK query also scopes customer membership through `bar_customers.bar_id`.

### Additional critical legacy guard

Because `transactions`, `wallets`, achievements, wheel records and shop purchases are user-centric rather than venue-attributed, the legacy adapter refuses these reads for any company other than `pivnik`.

Error:

```text
LEGACY_ADAPTER_NOT_TENANT_SAFE
```

This prevents a future second tenant from accidentally receiving PIVNIK ledger/customer economics merely because one user becomes associated with more than one bar.

Before real multi-tenant ledger analytics can be enabled for a second tenant, new transaction/event rows need explicit `company_id` / `venue_id`.

## 5. Database connections

### Metadata writer

`ADMIN_DATABASE_URL`

Used for Admin-owned:
- accounts;
- sessions;
- access mapping;
- audit;
- future config tables.

It should not receive DML grants on customer production tables.

### Production reader

`ADMIN_READ_DATABASE_URL`

Used by production read adapters.

The pool starts with:

```text
default_transaction_read_only=on
```

Deployment guidance additionally requires a PostgreSQL role with SELECT-only grants.

This is defense in depth:
- route read-only gate;
- no customer mutation SQL in read data layer;
- separate read pool;
- read-only PostgreSQL session default;
- SELECT-only database role.

## 6. Authentication

Implemented:
- normalized email lookup;
- scrypt password hashing;
- minimum 12-character password policy;
- opaque random session token;
- only SHA-256 session-token hash stored in DB;
- HttpOnly cookie;
- SameSite=Strict;
- Secure cookie required in production;
- server-side session expiration;
- session revocation by deletion;
- HMAC CSRF token bound to session token;
- mutation Origin validation;
- login rate limit;
- login/logout/bootstrap audit events.

No admin password or admin secret is included in frontend JavaScript.

## 7. Read-only Admin API

Implemented endpoints:

```text
GET  /api/admin/health
POST /api/admin/auth/login
GET  /api/admin/auth/session
POST /api/admin/auth/logout

GET /api/admin/venues
GET /api/admin/platform                      SUPER_ADMIN
GET /api/admin/audit                         SUPER_ADMIN

GET /api/admin/venues/:venueId/dashboard
GET /api/admin/venues/:venueId/clients
GET /api/admin/venues/:venueId/clients/:userId
GET /api/admin/venues/:venueId/operations
GET /api/admin/venues/:venueId/achievements
GET /api/admin/venues/:venueId/wheel
GET /api/admin/venues/:venueId/shop
GET /api/admin/venues/:venueId/promotions
GET /api/admin/venues/:venueId/loyalty
GET /api/admin/venues/:venueId/design
GET /api/admin/venues/:venueId/capabilities
GET /api/admin/venues/:venueId/audit
```

All non-GET venue routes are blocked while:

```text
ADMIN_READ_ONLY=true
```

There is intentionally no “quick bonus mutation” backdoor.

## 8. Frontend integration

The Phase A visual shell remains.

Runtime changes:
- demo role toggle removed;
- real login screen added;
- real admin session required;
- real authorized venue list loaded;
- production pages display source-aware data;
- NORTH BAR / MOKKA / BRUT seed tenants are no longer rendered in production runtime;
- customer write buttons are visibly disabled;
- missing production metrics show `Нет данных`;
- loading/error states are explicit;
- Admin service outage page explicitly remains separate from VK/TG.

Phase A demo modules still exist as source/reference code but are no longer wired into `App.tsx`.

## 9. Configuration foundation

Migration `002_configuration_foundation.sql` creates additive future Admin-owned tables:

- `venue_settings`
- `loyalty_levels`
- `wheel_configs`
- `wheel_prizes`
- `achievement_configs`
- `shop_item_configs`
- `promotion_configs`

They are **not consumed by the VK/TG runtime yet**.

This is deliberate.

The future customer runtime adapter must use:

```text
validated DB value
  -> if absent/invalid:
legacy constant/default
```

and must be introduced one setting at a time with rollback tests.

## 10. No automatic deployment/migration

Admin startup does not execute migrations.

Migration requires:

```text
ADMIN_ALLOW_MIGRATIONS=true
npm run db:migrate
```

Admin account bootstrap is also explicitly guarded.

No Railway/Vercel/VK/TG service has been changed or deployed by this work.

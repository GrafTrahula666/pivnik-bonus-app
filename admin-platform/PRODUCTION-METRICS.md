# Production metric definitions

The Admin Platform must not turn missing telemetry into invented business intelligence.

## Available now from the existing PIVNIK database

### Total Customers

Source:

```text
bar_customers + users
```

Definition:

active membership in the mapped PIVNIK `bars.id`, excluding merged/deleted user rows.

### New Customers

Source:

```text
users.created_at
```

Definition:

mapped customers whose canonical user record was created inside the selected interval.

`bar_customers.joined_at` is not used for historical registration because the current platform migration backfilled membership for existing users.

### Active Customers — transaction-active

Source:

```text
transactions
```

Definition:

distinct mapped users with a completed transaction inside the period.

UI label intentionally says:

```text
Активных по операциям
```

This is **not** presented as DAU/MAU.

### Returning Customers

Definition used by the read-only adapter:

customer created before the selected period who has at least one completed transaction during the period.

This is a transaction-return definition, not app-session retention.

### Tracked Revenue

Source:

```text
transactions.cash_paid_cents
```

Filter:

```text
status='completed'
mode IN ('accrue','redeem')
```

Formula:

```text
SUM(cash_paid_cents) / 100
```

It represents registered-customer cash tracked by the loyalty ledger.

### Check Count

Completed `accrue` / `redeem` transaction rows with `check_amount_cents > 0`.

### Average Check

```text
AVG(check_amount_cents) / 100
```

over completed `accrue` / `redeem` rows with a positive check.

### Bonus Earned

```text
SUM(transactions.bonus_earned)
```

over completed transactions in the selected period.

### Bonus Redeemed

```text
SUM(transactions.bonus_spent)
```

over completed transactions in the selected period.

### Outstanding Bonus Balance

```text
SUM(wallets.balance)
```

for active canonical PIVNIK customers.

This is a points balance, not automatically an accounting currency liability.

### Redemption Rate

Current points-based definition:

```text
bonus redeemed / bonus earned * 100
```

for the selected period.

If earned = 0, UI returns `Нет данных`.

### Operations

Count of completed transaction rows for mapped PIVNIK customers.

### VK / Telegram split

Source:

```text
user_identities
```

Current production runtime reports account mode `separate`.

The Admin UI therefore does not treat VK/TG as automatically unified people.

### Wheel Spins

Source:

```text
wheel_spins
```

Available:
- spin count;
- unique users;
- retry/paid spin spend;
- bonuses awarded;
- beer awarded;
- actual prize distribution.

Current production gateway exposes wheel use to Telegram only even though later schema permits a platform value.

### Shop Purchases

Source:

```text
shop_purchases
```

Available:
- purchase count per item;
- bonus spend per item.

Legacy `shop_items` is global content rather than tenant-scoped, so it is exposed only for the mapped PIVNIK tenant.

### Achievement Unlocks

Source:

```text
user_achievements_v2
```

Available:
- tracked users per achievement code;
- unlocked count;
- unlock rate over tracked rows;
- last unlock.

Legacy display metadata still comes from application code; the read-only Admin API does not invent CMS titles for missing DB metadata.

## Not reliably available now

### True DAU / WAU / MAU

Status:

```text
Нет данных
```

Why:
there is no durable, tenant-attributed `app_activity` event for each meaningful app session/activity.

Needed event example:

```text
analytics_events
- company_id
- venue_id
- user_id
- platform
- event_type = 'app_activity'
- occurred_at
```

Then:
- DAU = distinct user_id over one day;
- WAU = distinct user_id over trailing seven days;
- MAU = distinct user_id over trailing thirty days.

### Visits

Status:

```text
Нет данных
```

A transaction is not automatically a venue visit.

Needed event:

```text
venue_visit
```

with explicit venue attribution.

### 7/30/90 retention

Status:

```text
Нет данных
```

Transactions can produce a transaction-return metric, but that is not silently relabeled as app/customer retention.

Needed:
- acquisition/cohort anchor;
- durable `app_activity` or `venue_visit`;
- venue/company attribution.

### Full venue-level revenue for future tenants

Current `transactions` has no `venue_id`.

Therefore the PIVNIK legacy adapter is intentionally hard-gated to the PIVNIK company.

Before onboarding a second real tenant, ledger-producing events must include an unambiguous venue id (or use a new tenant-owned ledger keyed by venue).

## Event collection recommendation

Add an append-only analytics/event stream separately from core wallet logic:

```text
analytics_events
- id
- company_id
- venue_id
- user_id nullable
- platform
- event_type
- occurred_at
- properties jsonb
- idempotency_key nullable
```

Minimum events:
- `app_activity`
- `registration_completed`
- `venue_visit`
- `receipt_completed`
- `bonus_earned`
- `bonus_redeemed`
- `wheel_spin`
- `shop_purchase`
- `achievement_unlocked`

The event collector must never become required for customer transaction success: analytics failure should be best-effort / recoverable and must not block VK/TG.

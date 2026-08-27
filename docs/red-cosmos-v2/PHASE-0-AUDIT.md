# RED COSMOS v2 — Phase 0 production audit baseline

Audit mode: **READ ONLY**. No production rows were changed by this audit.

Captured from the production database on 2026-08-27 before RED COSMOS v2 development continues.

## Important schema mapping

The SQL examples in the product specification describe a target/logical schema, but the current production schema uses different names. The audit therefore uses the existing authoritative tables rather than inventing columns that are not present.

| Logical concept from v2 spec | Current production source of truth |
| --- | --- |
| VK / Telegram identity links | `user_identities` (`provider`, `provider_user_id`, `provider_username`, `user_id`) |
| Current bonus balance | `wallets.balance` |
| Bonus transaction history | `transactions` (`client_id`, `bonus_earned`, `bonus_spent`, `balance_after`, `mode`, `status`) |
| Earned achievements | `reward_grants` with `source='achievement'` and `achievement_code` |
| Legacy/special grants and old frame entitlements | `beta_grants` |
| Currently selected frame | `users.profile_frame` |
| Beer/litre state | `beer_loyalty` |
| Wheel history/state | `wheel_spins` (cooldown derived from spin history) |
| Shop purchases | `shop_purchases` |

`reward_grants` is already indexed for real ledger-backed achievements. `user_identities` is the platform identity table. The existing wheel schema is Telegram-only and explicitly constrains `platform = 'telegram'`; RED COSMOS v2 must migrate it safely rather than merely exposing the existing Telegram UI in VK.

## Production baseline numbers

### Users

- total users: **12**
- active users: **12**
- merged users: **0**
- deleted users: **0**
- first user created: `2026-08-19T06:39:22.466Z`
- last user created: `2026-08-27T04:03:33.937Z`
- users created before the troubleshooting window: **4**

### Platform identities

- Telegram identities: **7** identities / **7** users
- VK identities: **4** identities / **4** users
- one active user currently has no `user_identities` row (12 users vs 11 platform identities)

### Wallets / bonuses

- wallets: **12**
- non-zero wallets: **8**
- zero wallets: **4**
- total current wallet balance: **1,002,055 B**
- active wallet balance total: **1,002,055 B**
- wallet vs latest transaction `balance_after` mismatches: **0**
- zero wallet while latest ledger balance is positive: **0**
- merged-user wallet balance: **0**
- deleted-user wallet balance: **0**

### Transactions

- total transactions: **20**
- completed transactions: **20**
- users with completed transactions: **8**
- first transaction: `2026-08-19T08:07:06.802Z`
- last transaction: `2026-08-27T04:03:37.224Z`
- transactions before troubleshooting window: **6**

Known transaction-mode totals from the audit:

- `welcome`: **8**, earned **800 B**
- `adjustment`: **11**, earned **1,001,255 B**
- `achievement`: **1**, earned **0 B**

### Beer / litres

- beer loyalty rows: **12**
- users with paid litres: **0**
- users with gift litres: **0**
- total paid ml: **0**
- total gift ml: **0**

This is a real data problem to investigate. The current production database contains no non-zero litre state to “restore” from the live rows.

### Frames

Selected frame distribution:

- `none`: **10** users
- `money`: **1** user
- `olesya`: **1** user

No merged/deleted frame rows were found by the audit. Legacy frame restoration must therefore search grants/backups/history rather than assume active `users.profile_frame` still contains every old entitlement.

### Achievements / grants

The current DB already contains achievement/grant history, including:

- `achievement:creator` / `creator` — present for one user
- `achievement:beta-tester` / `beta-tester` — present
- `beta-tester-legendary` legacy grants — present
- `olesya-heart-million` legacy grant — present

The target three handles for “Поднять щиты” do **not** currently resolve by username or identity username:

- `@drolted`: 0 matches
- `@distraktor`: 0 matches
- `@KSEMAR`: 0 matches

No +750 grant will be made until each target is resolved to exactly one real account from historical data or a confirmed identity.

### Wheel

- existing `wheel_spins`: **2**
- platform: Telegram
- shop purchases: **0**

The existing migration defines the wheel as Telegram-only (`CHECK (platform = 'telegram')`). A correct VK wheel requires a DB migration and a shared server route, not just exposing the Telegram wheel markup.

### Admin / owner signal

Current admin profile found by the production audit:

- username: `OriginalToPG`
- display name: `TopG`
- selected frame: `money`
- balance: **300 B**
- platform: Telegram

No unambiguous VK owner match was found in the current live identity rows. Creator entitlement must be preserved and owner VK mapping must be solved without guessing.

## Data-preservation baseline for the final audit

These values must not decrease as an unintended side effect of RED COSMOS v2:

- active users: **12**
- completed transactions: **20** before any intentional v2 grants/purchases
- wallet total: **1,002,055 B** before intentional v2 grants/purchases
- wallet/ledger mismatch count: **0**
- existing creator/beta/legacy grants: must remain present
- selected legacy frames `money` and `olesya`: must remain restorable/owned

## Phase-0 conclusions

1. The live data is not a freshly empty database, but it is much smaller than historical counts from older production snapshots.
2. Bonus wallets are internally consistent with the current ledger; do not “repair” balances blindly.
3. Litres are currently zero in live production and require a separate historical-source investigation.
4. Existing achievements must be migrated/preserved from `reward_grants` and `beta_grants` rather than replaced.
5. The existing wheel schema is genuinely Telegram-only; VK requires a real migration.
6. The old shop must be hidden, not deleted, and existing grant/frame history must remain intact.
7. Special tester bonuses are blocked until identity resolution is exact.

Phase 0 is complete. Development continues from stable commit `6a1d36da624e53e71ae4f0710dfe5fd892319a8e` on branch `feature/red-cosmos-v2`.

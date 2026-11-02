# CHAT 09 / 82: unified server chart aggregate, Draft checkpoint

**Main baseline:** `c92ed7cd65f1a96d94363c2b7e212424ab078a73`. **Branch:** `spaceverse/chat09-timeseries-aggregate-20261101`. **Scope:** task 82 only, no merge/deploy.

Existing POS and loyalty/operations endpoints expose the same additive `timeSeries`
shape without changing legacy response fields or frontend. Values are **signed
decimal strings in minor currency units**, with `source`, `metric`, `scope`,
`period`, `Europe/Moscow`, `groups.days` and `groups.hours`.

- Evotor POS: `source=evotor_pos`, `metric=net_cash`, currency unknown
  (`null`), bound to company+venue and the existing enabled store mapping;
  available only when connection/sync already meets current read threshold.
  Missing schema/binding/sync -> `timeSeries:null`, **not zero**.
- PIVNIK transactions: `source=pivnik_loyalty`, `metric=tracked_cash`,
  currency RUB, unchanged companyCode/legacyBar guards; `hours:null` when
  hourly SQL was not requested. Daily SQL now uses Moscow calendar days in
  all modes, not the database session timezone.
- Hour-of-day is **folded across all selected days**; it is not an hourly
  timestamp series. Day/hour totals must agree if both were computed.
  `coverage=read_model_only` does not assert provider fiscal completeness.
- Data is not combined across different sources/tenants; old charts and money
  calculations stay unchanged. No arbitrary SQL, no new query for POS, no
  runtime migration/config/secret/production write.
- Tests: new pure `server/tests/time-series.spec.ts`, additions to existing
  Evotor disposable PostgreSQL/WASM regression. Existing root/Business gates
  required before merge. Local npm tests **NOT RUN** in connector-only runtime;
  check exact GitHub CI run after this commit.
- Next: once 82 is verified, hand off Draft PR to CHAT 01. Task 83 ranking
  product/category must be handled separately and only from verified receipts.

# SpaceVerse → Evotor stock: production preflight, 2026-10-25

## Mandate and exact source

Implement the owner's four-control beer intake against the real Evotor product,
preserving parallel bartender sales. No alternate CRM inventory, new products,
guest data, payment, receipt or bonus changes are authorized by this task.

Fresh GitHub main: `ecf9057ffd352c220b55eccb1dee820d6c6c35b7`.
PR #309 (`ac91bec5d23f2ee3155aaa55447222a8f791ef81`) and #310
(`ecf9057ffd352c220b55eccb1dee820d6c6c35b7`) are merged. Continue those files;
do not restart the warehouse implementation. The existing local checkout had
uncommitted older Evotor changes and was preserved. Work is isolated in
`fix/spaceverse-evotor-safe-stock-20261025`. No Weekly audit digest issue was
found by the connected GitHub issue search.

## Live observations

- Railway `content-nature`: `20a942f9-3164-484a-a6f1-565439e38705`, production
  `cdd9d26c-2aab-45d9-95ed-ef487fafaa8f`.
- Owner CRM `admin-pilot`: `bc1722fd-ef21-462a-96b4-519f91eafc31`, repository
  main, Dockerfile `admin-platform/Dockerfile`. This is not admin staging.
  URL: https://admin-pilot-production.up.railway.app
- Initial live deployment `b9abd57b-c40e-4ae0-a39e-a19a6ff3b8fc` was SUCCESS.
  No intake flags/token/store names were configured on this service initially.
- The existing `pivnik-bonus-app` has the store/token variables. No values were
  read or printed; the diagnostic and owner service use Railway variable
  references. No credentials were sent to the browser or repository.
- Read-only SQL: metadata has venue `1`, company `1`, name ПИВНИК. Production
  reader has exactly the expected enabled store binding for tenant/location `1`.
- Operation journal 019 is absent from the metadata DB. No migration is necessary
  for blocked writes; no schema or balance was changed. Before a future enabled
  rollout, take/verify a metadata backup and apply 019 manually, not on startup.
- Read-only cloud requests at 13:34 UTC (16:34 Moscow): stores HTTP 200,
  documents HTTP 200, products HTTP 403. No product list, quantities or write
  permission could be confirmed. HTTP 403 is not an empty inventory.
- One-off diagnostic service `ec207d2c-e692-474d-86cb-f2fe5da3d8b1` uses
  `BEGIN READ ONLY`, driver read-only defaults and bounded SELECT/GET requests.
  It has no public domain, no schedule, restart NEVER, and no write path.

## Why the current write cannot be enabled

The official [PATCH product contract](https://developer.evotor.ru/docs/rest_api_patch_store_products_product.html)
sets absolute `quantity`; it does not document a delta or a conditional write.
The existing expected timestamp check occurs before PATCH and is not a provider
CAS. Local locks serialize only CRM requests. Successful re-reading cannot
detect an already overwritten sale.

Counterexample exercised against the actual adapter with a controlled provider:
GET returns 25 l; a terminal sells 1 l; CRM PATCH writes 25+50=75 l and re-reads
75 l. The correct value was 74 l. The former success check accepts this loss.
Retries, an extra GET, idempotency IDs or local locks do not repair that race.

The official [document schema](https://developer.evotor.ru/docs/rest_api_scheme_documents.html)
describes ACCEPT received from the terminal; the inspected REST contract does
not establish a cloud API for posting an atomic intake. The inspected official
SDK InventoryApi only exposes inventory reads/extra fields, not a verified atomic
stock-increase call. This does not prove no private/new provider API exists;
its contract and availability must be established before enabling writes.

The [initial synchronization guide](https://developer.evotor.ru/docs/rest_quantities_synchronization_guide.html)
warns of zeroed quantities when first connecting a goods-accounting system.
Do not take over stock accounting, reconstruct a competing CRM stock balance,
or initialize product quantities to zero to obtain access.

## Changes and safe operational state

- A server gate rejects increments before any journal, audit or provider write,
  even if `ADMIN_ENABLE_WRITES`, `ADMIN_ENABLE_BEER_INTAKE` and
  `ADMIN_ENABLE_EVOTOR_STOCK_WRITES` are true. Existing absolute-write code is
  retained behind the gate rather than silently promoted as safe.
- Product listings return the real provider rows and a disabled write capability
  with a human-readable reason; the existing UI displays it without new controls.
- Owner service token/store references are prepared. Intake and stock-write
  flags are explicitly false. Global write controls and all bonus flags are
  untouched. Both env templates document the same safe defaults.
- Tests cover the real absolute-PATCH race, fail-closed service behavior, unchanged
  product identity/quantity, trusted-director HTTP denial and blocked UI actions.

## Remaining external acceptance gates

1. Restore developer-portal access and resolve the products HTTP 403. Check the
   actual application's `product:read` and `product.quantity:read` permissions
   and its installation/authorization for this store. The documented OAuth
   [scope table](https://developer.evotor.ru/docs/rest_oauth20_authorization_guide.html)
   also defines `product.quantity:write`; granting it alone does not solve the race.
2. Obtain a supported provider-side delta/CAS or safe stock-document contract
   that is serialized with terminal sales, including timeout/idempotency behavior.
3. Only then migrate the operation journal after backup and exercise a specifically
   approved test SKU/store, including concurrent sale, unknown response, repeated
   request, cloud read-back and terminal synchronization. Never pick a random
   production SKU or use a production sale as a synthetic test.

No real stock update or physical terminal acceptance has occurred in this task.
The requested status remains **НЕ РАБОТАЕТ** until these gates are met.

Rollback of the safety-only deployment: keep both intake flags false. Do not
enable the old absolute PATCH path. Other CRM screens and the cashier app remain
outside this change.

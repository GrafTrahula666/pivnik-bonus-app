# CHAT_06 · P0 fiscal document source and normalization contract

**Task:** 51/60. **Scope:** contract only; no runtime, route, migration, secrets, provider call, POS, or production changes.
**Baseline inspected:** `main` `c92ed7cd65f1a96d94363c2b7e212424ab078a73` (2026-11-01).
**Status:** documented from official public API and existing source; **NOT live-verified** with an authorized test store. Not a permission to enable the SaaS consumer.

## 1. Single authoritative source

For SPACEVERSE cash-sale analytics use the Evotor **Cloud REST V2** list endpoint:
`GET https://api.evotor.ru/stores/{store-id}/documents` with an independently authorized **server-side** provider token and REST V2 headers. **Not** client-entered receipt amounts, an SDK draft/open cart, POS callback payload, Telegram/VK loyalty transaction, or a fabricated revenue ledger.

Authoritative public references:
- https://developer.evotor.ru/docs/rest_api_get_store_documents.html
- https://developer.evotor.ru/docs/rest_api_scheme_documents.html

The initial request selects `type=SELL,PAYBACK`; optional `since` is inclusive and `until` exclusive, both epoch **milliseconds**. Each is sent **only on the first page**. Later requests submit **only** the opaque `cursor` copied unchanged from the preceding `paging.next_cursor`; empty `paging` ends the scan. Preserve a bounded frozen upper bound for a scan; do not interpret a partial page scan as complete history. A page's `items` is not itself evidence of historical completeness.

## 2. Fail-closed eligibility for SaaS consumers

Before a future SaaS data read, authorize the actual signed-in SPACEVERSE identity to the canonical company and venue **server-side**. Recheck an independently verified exact `product_id/store_id` binding, its current token revision, provider identity/installation, reconciliation and hold/revocation state, and the separately approved license/entitlement policy. A pending, held, revoked, unmounted or stale binding is **not** eligible. No query may take a `tenant_id` or `store_id` supplied by the browser as authorization. Revalidate scope during paginated reads as required to prevent revoked credentials from authorizing a continued scan. Never leak a foreign business's data.

**Existing prerequisite is not complete:** `admin-platform/server/evotor-market-store-binding.ts` and the license guard are unmounted; binding `pending` has no production `ready` transition. The root `pos/*` importer is **legacy PIVNIK**, not a multi-tenant SaaS reader. Do not mount or reuse it for other tenants until task 52 proves the above.

## 3. Canonical normalized document (existing baseline, not a new implementation)

The current **single reusable normalizer** is `pos/evotor-document.js:normalizeEvotorDocument`. Its callers are `pos/repository.js`, `pos/sync.js`, `pos/recent-sync.js`; HTTP acquisition is `pos/evotor-client.js:fetchEvotorPage`. Do not create a parallel money parser. For any new adapter, keep one equivalent validated immutable projection and prove compatibility using tests before integration.

| Raw provider field | Normalized value / invariant |
|---|---|
| `store_id`, `id`, `type` | Exact verified store, nonempty document ID, `SELL` or `PAYBACK`. Key by `(source, store_id, document_id)`. Do not silently accept a foreign store. |
| `close_date` | Valid instant stored as UTC `closedAt` and SQL `closed_at`. Cloud documentation describes the time the terminal **saved** the document. No additional provider `status=closed` field is asserted by this endpoint. Do not invent one. |
| `body.result_sum` | Exact decimal (up to 2 fractional digits) into integer `amountCents` via checked decimal scaling, never floating-point multiplication. Raw amounts nonnegative. Sign is applied **only** in projections: `SELL` positive; `PAYBACK` negative. |
| `body.positions[]` | `productId`, bounded display `name/measure`, integer `quantityMillis` (3 digits), integer `amountCents`. Do not use a position sum in place of document total. |
| `body.payments[]` | Each nested `payment.sum` in cents, `type`, optional cashless method; preserve split/payment types. Do not infer customer identity from cash/card method. |
| `body.base_document_id` | Optional original sale document ID for `PAYBACK`. Missing ID means **unknown ancestry**, not a fabricated linked sale. |
| `body.pos_print_results[]` | Fiscal print evidence; existing `receiptCount` is print count or `null` if absent. **Unknown is not zero**. Split receipts must not be treated as a single receipt/customer. |
| `extras` / contact fields | Never persist arbitrary third-party extras, phone, name, email or inferred customer identity. Only validated own-app versioned evidence may be projected. |

Reject malformed typed documents, foreign store, invalid dates/amounts, financial field conflicts, unexpected response envelopes, non-progressing cursors, and unauthorized reads. Preserve immutable closed-document snapshots: identical re-delivery is idempotent; conflicting snapshots block import, not overwrite financial truth. A return without an original sale is still a refund in cash analytics but cannot be attributed to that sale's customer.

## 4. Analytics and history interpretation

On the same normalized source and selected business day/window, retain separate gross sales, refunds and net revenue (sales minus refunds). Do not turn `PAYBACK` into negative persisted `amountCents` **and** subtract it again. The sales-document count, fiscal receipt count and refund-document count are distinct. A fiscal count unavailable for some documents is unknown, not `0`; therefore average receipt based on that count is unavailable, not fake precision. Existing PIVNIK `pos/analytics.js` uses Europe/Moscow; future SaaS stores require an explicit verified venue time zone and tested boundary rules, task 56. Do not claim full history merely because an overlapping recent scan completed.

Keep states separate: `zero confirmed revenue`, `history incomplete`, `no successful scan`, `connection lost`, `permission denied`, `not configured`. Empty cloud result and denied/failed import are different. Define observable freshness from a confirmed successful ingest, not from latest HTTP attempt.

## 5. Provenance, tests and handoff checkpoint

Checked source at baseline: `pos/evotor-client.js`, `pos/sync.js`, `pos/recent-sync.js`, `pos/repository.js`, `pos/evotor-document.js`, `pos/analytics.js`, `ops/MODULE-MAP.md`, `ops/EVOTOR-MARKET-REQUIREMENTS.md` and the two official Evotor pages. Existing PIVNIK behavior and the pending Admin Market prerequisites remain unchanged.

**Task 51 checkpoint:** Contract recorded. Provider live `SELL/PAYBACK` and SaaS-read eligibility **NOT VERIFIED**; no production changes. **Tests in this session:** not executed, since no repository checkout/node_modules are mounted. CI status for this new branch must be checked on its exact commit; it is not yet evidence of live integration.

**Next strictly scoped task 52:** after fresh preflight/checkpoint, design and test an **unmounted/read-only**, fail-closed exact-store, tenant-safe SaaS document reader, with negative tests for foreign company/venue, pending/revoked/held binding, rotated provider token, missing license, mid-flight revoke and cursor replay. Do not touch legacy `pos/*` or mount a production route until upstream P0 prerequisites and explicit gate are resolved. If live proof is externally blocked, mark BLOCKED and perform only standalone safe preparation. Hand off Draft PR to CHAT_01 coordinator; never merge/deploy here.

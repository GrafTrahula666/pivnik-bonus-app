# PIVNIK — БОНУСЫ: one native checkout window

The owner approved this flow on18October2026: open payment, open
**PIVNIK — БОНУСЫ**, scan/select the customer, review their real identity and
balance, then either redeem or return to cash/card payment for after-close
accrual. Every new sale starts without a customer. Buyers without the app must
never credit the previous customer.

## Implementation

- 1.0.16/code20 opens with the keyboard hidden and initial focus on the bonus
  window, so neither customer-code nor points input steals the checkout screen.
  Tapping an editable field still allows manual entry; explicit entry resizes
  the window. Both the Activity and built manifest set the initial keyboard
  policy. Scanner callbacks, receipt binding, credentials and money are unchanged.

- The existing official receipt-discount tile is renamed; there is one tile.
  `RedemptionActivity` accepts permission-restricted scanner broadcasts only
  while resumed. Manual short-code/QR input uses the same narrow parser and
  exact source-receipt resolve/bind. Pending work ignores duplicate scans;
  unresolved redemption prevents customer selection. Replacement confirmation
  remains. Identity/balance stay visible separately from quote availability.
- Normal return completes with SDK `KEY_SKIP`, preserving existing discounts,
  positions, extras, loyalty and payments. Zero discount is never returned merely
  to close the window. Actual redemption/cancellation retain the existing SDK
  result, durable journal and financial guards.
- The former product-barcode service/card are removed. The owner reported the
  1.0.14 empty-group candidate retained the product error. It is not reused.

## Identity isolation

Identity is keyed by receipt UUID. Completion/clearing removes identity and
pending replacement; opening a new receipt removes stale ones. Stored identity
never answers for another UUID, even after restart or a missed close event.
Returning to payment retains identity for the SAME unpaid receipt; deleting it
on window close would break ordinary after-close accrual.

Live `BindingPolicy.ScanTicket` records capture receipt scope before queued work.
Closing/cancelling that receipt or opening another invalidates the ticket; a
late reply cannot recreate cleared identity even if the provider still returns
the old header. Another receipt's delayed completion leaves the current ticket
valid. Bridge releases tickets in finally, not as an unbounded history.

Historical backend claims remain for closed-document accrual, idempotency and
refunds. They are queried by exact receipt UUID and are never a default customer
for future sales. No server/DB or monetary policy is changed.

## Verification and physical acceptance

Core tests cover close/cancel, next buyer without an app, restart/missed close,
late replies, pending replacement clearing and independent receipts. Robolectric
checks actual SDK skip completion, scanner subscription/permission, manual
invalid-code handling and actual SDK close/clear/open broadcasts. Existing
financial tests and PostgreSQL concurrency checks remain required.

Physical acceptance: compatible update over1.0.14; open the single tile and enter
a known code remotely (or scan when available), verify client/balance, return
with «К оплате», and verify native payment remains usable. Complete/cancel a
receipt; open another without scanning and verify no customer/old balance and
no cashback for the previous guest. Manual input does not prove the hardware
scanner. Native discount/cancellation, closed-cloud markers and real accrual
are separate acceptance gates; new real reservations stay default off pending
controlled acceptance.

Permanent certificate/device key, proxy routes, Selectel/VK service, monetary
locks and cloud worker are preserved. No commercial Market submission.

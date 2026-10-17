# Native sale loyalty — implementation and acceptance

Owner's requested flow: scan the guest QR on the ordinary Evotor sale screen,
show the linked guest and their real balance, offer **Списать баллы** on the
payment screen beside ordinary payment options, and accrue after payment when
redemption is not selected. Do not require opening the setup screen per sale.

## Evidence and current implementation

- Owner's physical 1.0.12 screenshot proves keyless connectivity through the
  Selectel ingress; owner separately reports **Ключ принят**. The setup button
  remaining visible did not mean that the key was missing.
- Device screenshot: model ST-3.10 (Evotor 10), Evotor OS4.9.12. This is not an
  observed EvotorPOS application version.
- Base: PR277 source ccea83c plus current main40b341ad in a separate worktree.
  The old dirty worktrees and permanent APK signing identity are preserved.
- This draft fixes setup presentation and adds read-only wallet data opt-in to
  the existing authenticated QR resolve route. Both runtime mounts inject their
  existing unlimited policy. No policy is inferred from a QR or supplied ID.
- Android retains an optional balance snapshot with the exact receipt binding.
  Re-scanning refreshes display data without renewing identity lifetime. A
  receipt change while bind is in flight suppresses the previous guest result.
- Candidate1.0.13/code17 adds a native scan guest card and the official
  **Списать баллы** discount tile. Server reservations, cancellation tombstones,
  closed-document settlement and spent-point refunds are implemented separately
  from ordinary cashback. New reservations remain default off.
- No candidate APK is installed or hardware accepted. The final scan behaviour,
  SDK discount/marker delivery and cash/card fiscal flows are unobserved.

## Native SDK contracts and unresolved boundary

Sources:

- https://developer.evotor.ru/docs/doc_java_app_icon.html
- https://developer.evotor.ru/docs/doc_java_discounts.html
- https://developer.evotor.ru/docs/doc_java_return_positions_for_barcode_requested.html
- https://developer.evotor.ru/docs/doc_java_barcode_scanner.html
- Local official integration-libraryv0.6.40 source under work/evotor-audit/sdk.

The payment tile is supported: a service subscribed to
`evo.v2.receipt.sell.receiptDiscount` can declare `android:label="Списать баллы"`.
Its activity returns an actual `ReceiptDiscountEventResult`; the remaining
amount is paid by the normal cash/card flow. A tile alone is not redemption.

The standard barcode integration searches for **products** alongside the POS.
An empty positions result is not a documented guarantee that native product
lookup is suppressed. Modern SDKs also have groups of positions for POS6.35+;
an empty group is likewise not proven to consume loyalty codes on this device.
The scanner broadcast receiver documentation subscribes in Activity.onResume
and unsubscribes in onPause. Do not invent an always-on ordered-broadcast abort,
register a fictitious product, add a zero-priced receipt line, or promise an
arbitrary permanent native sale-screen widget.

`PivnikSellService` now launches `NativeCustomerActivity` through the supported
integration-activity callback, capturing the current receipt UUID at the event.
The card shows the verified guest and wallet snapshot; it never creates a fake
product. Product-error suppression on the actual EvotorPOS version remains
unproven. The owner is away from the till: finish independent code/build work
now, and perform the final device acceptance when the owner can use it.

## Financial implementation and remaining device acceptance

Existing staff rules are 1point=1RUB and at most30% of the check, in whole points.
Use these rules on the till as well; cashback is calculated by the current
server status rule on the amount actually paid. The device display balance is
a snapshot and never authorizes a wallet mutation.

The implementation follows these requirements; local/CI tests do not replace
the physical device acceptance listed below:

1. A durable reservation uniquely associated with store, device, receipt UUID
   and the currently verified guest. A retry returns the same reservation;
   another amount/guest requires removing the old receipt effect first.
2. Balance reservation under the existing wallet/user locks, competing safely
   with staff, wheel and other wallet operations. A table of holds ignored by
   other writers is not sufficient to prevent double spending.
3. Apply the exact confirmed amount to the real receipt through the SDK. Check
   UUID and current basket again after each asynchronous response. Preserve
   other applications' discounts and receipt metadata.
4. Persist the local pending operation before returning a discount to the POS.
   A crash/restart must reconcile with the same receipt, not start another debit.
5. Settle from the authoritative closed Evotor cloud document only. Native
   callbacks or requested totals do not establish a paid sale. Retain only a
   narrowly parsed own-app reservation marker and necessary discount data in
   the financial snapshot; never persist arbitrary extras or contact data.
6. Cancel only after the own receipt discount is removed/voided. No blind
   time-based release: an offline paid receipt may reach the cloud later.
   A closed receipt without the intended effect can release its hold once.
7. Handle edits, alternate guest scans, deferred receipts, partial/mixed payment,
   SDK failure, response loss and duplicate callbacks without stale discount.
8. Refund spent points proportionally from authoritative return documents,
   cap cumulative refunds at originally spent points, and separately reverse
   earned bonuses using the existing return ledger. Cover partial then full
   return, several returns, repeated imports and already-cancelled accruals.
9. Preserve explicit tenant/store/device access and the current monetary locks,
   idempotency and cloud-source amount invariants. Use an additive manual
   migration and default-off activation until hardware acceptance passes.

## Acceptance

- Network/key checks and saved key survive a compatible in-place update.
- Native sale scan identifies a guest without a product error or fictitious line.
- Guest/balance remains identifiable for that receipt; the next receipt starts
  without the previous guest. Missing balance is not shown as zero.
- Cash/card without redemption creates exactly one accrual after a closed sale.
- Redemption changes the actual payable amount, consumes points once and earns
  only on the paid remainder. Insufficient funds/over-limit requests are denied.
- Cancelled sale, edited basket, crash/retry and partial/full refund reconcile
  both receipt effects and wallet ledger. Ordinary sales remain available.

The complete cash-register task is not accepted until these cases are observed
on the physical till. SaaS Market commercial publication remains a later task.

## Implementation details and rollout

- `pos/redemption.js` is the additional POS money writer. A reservation removes
  available points under shared user/wallet and receipt locks; an adjustment
  records it without creating a purchase or trusting a device-paid amount.
- The main runtime supplies the same monetary policy as its cloud bonus worker.
  Gateway financial calls forward there, including compatibility calls to the
  already allowed `receipts/bind` URL with `operation:"redemption"`. The APK
  therefore keeps its working server, saved key and installed proxy masks.
- The journal is durable before POST and before the SDK result. A requested,
  reserved, offered or removing operation is recovered by the same id, never
  automatically applied to another basket. Cancellation can tombstone a delayed
  request that has not reached the server yet.
- Android returns an actual receipt discount in rubles, retaining own-context
  extras. It refuses stacking over an existing document discount and refuses a
  new redemption after payment started. Before-position-edit rejects edits while
  a local unresolved operation exists; changing guests is also refused. These
  SDK guard semantics need device verification. Normal sales have no such guard.
- Cancellation with an applied effect returns zero through the SDK first. A
  later receipt read must prove zero discount before the server releases points.
  An unresolved response stays journaled and can be retried from the tile.
- Official REST documentation puts the caller app's context in top-level
  document.extras. Only `pivnikLoyaltyV1:{version:1,operationId,points}` plus
  document-discount cents is retained. A matching marker alone does not settle:
  the actual closed net and discount must match too. Unknown/mismatched effects
  enter review, with no silent release. Actual closed-document mapping remains
  a release acceptance item.
- Returns use explicit cloud baseDocumentId and a cumulative capped proportion
  of actual returned net. They refund spent points independently of cashback,
  including zero cashback or cashback already cancelled by an administrator.
- Manual migration023 is additive/repeatable, never startup. The setup command
  is `node scripts/evotor-redemption-setup.mjs --apply`, while new reservations
  are disabled. Existing historical snapshots remain unchanged when no own
  marker exists, preserving closed-document replay equality.

Rollout: merge only the checked head; deploy with new reservations disabled;
prepare migration023 explicitly; sign a compatible private APK with the existing
certificate; perform native scan/cash/card and receipt-marker acceptance before
activating customer spending. Keep the bonus worker on while reservations exist.
Rollback can disable new reservations immediately; existing reservations still
need reconciliation. Do not drop their tables or revert away the money lifecycle
while unresolved/committed holds or pending returns remain.

Known limits: no arbitrary permanent sale-screen widget, no promise of barcode
lookup suppression before physical testing, no stacking with another document
discount, no new redemption in a partially paid receipt, and no timer release
of a lost/deferred/voided unresolved receipt. Remove redemption before edits,
changing guests or voiding. A direct void/process loss with unknown receipt
effect may require owner reconciliation. These limits must remain explicit;
this candidate must not be described as a 100% completed cash-register setup.

## Local verification before PR

- Materialize twice: 863 indexed source files, zero byte changes on the second
  run. The driver restores only its own seven generated files after verification.
- Full Node suite:618 pass, no failures/skips after fixing the standalone checker
  filename. A subsequent long-open-receipt freshness fix has10/10 focused money
  tests; final checked-head CI must include this additional test.
- Full local JVM/ABI suite:61 pass, including receipt snapshot/empty loyalty/
  zero payment placeholders, durable operation parsing and credential encryption.
  The ABI jar was recovered from the supplied1.0.9 with missing InnerClasses,
  generic signatures and checked exceptions restored from the SDK sources;
  this does not replace a full Gradle build against the real dependency.
- PostgreSQL17: four concurrent scenarios pass, both in the initial loopback
  fixture and by running the committed standalone checker in an isolated network
  namespace with a fresh named database. No production data/credentials used.
- Existing actual gateway-forwarding HTTP fixture passes, including opaque
  Evotor Authorization with the real device header, canonical monetary policy,
  retry through both transports and an oversized-body refusal.
- npm audit exit0: zero vulnerabilities; production audit also reports zero.
- VK startup parity passes for prestart/materialize; static bundle builds with a
  dummy .invalid API base. Neither was deployed as a separate VK update.
- Live Railway runtime log confirms the existing bonus worker started at
  2026-10-16T18:34:32Z with120-second cadence. This confirms configuration, not
  real scanner attribution or a physical receipt's accrued bonus.

No new server deployment, migration, APK installation or customer reservation
activation is established by this local verification record. Record final CI,
artifact identity, release and hardware observations separately.

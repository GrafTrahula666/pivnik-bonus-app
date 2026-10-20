# POS/device contract — integration draft

`POST /api/device/pos/qr/resolve`, HTTPS, `Authorization: Device pvpos_…`,
JSON `{ "payload": "PIVNIK:…" }` or the existing short code.
Behind Evotor's proxy, send the device key in `X-Pivnik-Device-Key` because
the proxy replaces `Authorization` with its own token.
Success: `{ "client": { "id": "…", "firstName": "…" } }`.
Canonical `qr-resolver.js` handles aliases/revocation. No QR secret, phone,
social identity or staff/admin session is returned.

The separate sale-loyalty draft supports an explicit boolean `includeWallet`.
When true, the response also contains `wallet: { balance, unlimited,
pointsPerRuble: 1, maxSpendPercent: 30 }`, using the serving app's canonical
unlimited policy. This is a read-only snapshot of the resolved QR owner's wallet,
not a reservation or authorization to spend. Missing/invalid wallets return
503 `pos_wallet_unavailable`; the client must not invent a zero balance.
Omitted/false retains the exact old response. This extension is not yet deployed.

401: device key absent/revoked, wrong auth scheme or disabled store binding.
404: unknown/revoked QR. 429: retry later. 503: POS disabled/schema missing.
The bridge must continue the sale without linking on any failure. The key has
no admin/staff rights. Ordinary resolve/bind requests cannot mutate wallets.
The separately gated explicit redemption operations below reserve only the
currently claimed guest's points for that exact store/device/receipt.

A consented, signed native admin with explicit store management access issues
or revokes keys using `/api/admin/pos/devices` and `/devices/revoke`.
Keys are revealed once, hashes only are stored on the server, issue/revoke are
transactional and audited. One active key per store/external device ID.
If the issuance response is lost: list the device, revoke it and issue anew;
there is no token recovery endpoint. Never put credentials in commits or logs.

The Android bridge encrypts the device key with Android Keystore AES/GCM,
binds ciphertext to the configured endpoint and removes the old staff token.
It never renders a saved token and has no plaintext fallback. Keystore failure
leaves POS unconfigured. This behaviour needs validation on a test Evotor.

# Receipt binding and closed documents

`POST /api/device/pos/receipts/bind` accepts `{ receiptUuid, payload }` with a
device key and records the verified guest against that exact receipt UUID.
It refuses new claims while automatic POS accrual is disabled. The Android
bridge checks the same UUID before binding and after the response. A bind is
not a wallet mutation or proof that a receipt was paid.

The server worker settles a claimed closed SELL once using the cloud amount,
and reverses accruals from authoritative PAYBACK documents. The installed1.0.12
does not write guest IDs through SetExtra and does not implement redemption.
The normalizer does not consume arbitrary Extras. The 1.0.13 candidate reads
only the versioned own-app marker below; real closed-document acceptance is
still required before enabling reservations.

## Explicit redemption (1.0.13 candidate, default off)

The canonical `POST /api/device/pos/redemptions` and the existing allowed
`POST /api/device/pos/receipts/bind` with `operation: "redemption"` share one
authenticated, rate-limited financial implementation. The APK uses the latter
to retain the installed Evotor/Selectel URL masks. Both gateway transports
forward to the main financial runtime; it supplies the cloud worker's existing
unlimited policy. Ordinary binds retain their old response and behaviour.

Actions:

- `quote`: `{receiptUuid,clientId,totalCents,basketHash}` returns real available
  `balance`, `maxPoints` (whole points, 1RUB/point, at most30%) and any current hold.
- `reserve`: same fields plus stable UUIDv4 `operationId` and `points`. It
  immediately reserves available funds under user/wallet and receipt locks.
  Retrying the exact operation returns the same result; changed arguments fail.
- `status`: `{receiptUuid}` returns `redemption` or null; absence never proves
  that a delayed request cannot still arrive.
- `cancel`: `{receiptUuid,operationId,effectRemoved:true}` after the actual SDK
  discount is removed. It releases once, or creates a cancellation tombstone for
  a request not yet received. A closed cloud receipt cannot be device-cancelled.

Successful reserve returns `redemption:{operationId,receiptUuid,clientId,points,
totalCents,basketHash,state}`. States: reserved/committed/released/review.
The client journals before POST and before returning the real SDK discount.
It never settles on a native callback alone or automatically replays a discount
into a different/edited/partially paid receipt.

Android `SetExtra` writes `pivnikLoyaltyV1:{version:1,operationId,points}` while
preserving existing own-context fields. Official REST documentation places the
requesting app's context in top-level `document.extras`, not `body.extras` or an
invented app-id wrapper. Only those fields and narrowly parsed document-discount
cents survive normalization. Commit additionally requires actual closed net
amount +points*100 == reserved total and sufficient actual document discount.
Unknown/mismatched effects stay held for review; there is no timer release.
Matching marker plus zero document discount releases once. PAYBACK restores
spent points cumulatively, capped at the original amount, separately from
reversing cashback. No return is inferred from phone/name/date.

Manual migration023 and `node scripts/evotor-redemption-setup.mjs --apply`
prepare the schema, with new reservations disabled. Neither is in startup.
New quote/reserve operations require `PIVNIK_POS_REDEMPTION_ENABLED=true` plus
the existing accrual gate. Status/cancel and existing-hold reconciliation are
available when new reservations are disabled. Keep the worker enabled while
holds exist. See `ops/EVOTOR-SALE-LOYALTY-20261017.md` for rollout/acceptance limits.

See `ops/EVOTOR-INTEGRATION.md` for formulas, scope, provisioning and rollout
requirements. No installed production cash-register app was changed.

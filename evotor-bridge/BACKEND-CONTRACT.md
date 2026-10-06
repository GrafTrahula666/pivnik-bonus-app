# POS/device contract — integration draft

`POST /api/device/pos/qr/resolve`, HTTPS, `Authorization: Device pvpos_…`,
JSON `{ "payload": "PIVNIK:…" }` or the existing short code.
Success: `{ "client": { "id": "…", "firstName": "…" } }`.
Canonical `qr-resolver.js` handles aliases/revocation. No QR secret, wallet,
phone, social identity or staff/admin session is returned.

401: device key absent/revoked, wrong auth scheme or disabled store binding.
404: unknown/revoked QR. 429: retry later. 503: POS disabled/schema missing.
The bridge must continue the sale without linking on any failure. The key has
no admin/staff rights and no money/bonus write operation.

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

# Closed documents: unresolved external contract

The SDK code writes `pivnik_user_id` / `pivnik_v` through `SetExtra` for the
current receipt UUID. This is not proof of the REST document namespace.
The normalizer deliberately DOES NOT consume Extras until anonymized real
SELL/PAYBACK samples establish exact namespace, key and UUID correspondence.
Confirmed scoped administrative receipt→client linking is the only current
backend cohort source. It is a fallback, not automatic linkage on scan.

See `ops/EVOTOR-INTEGRATION.md` for formulas, scope, provisioning and rollout
requirements. No installed production cash-register app was changed.

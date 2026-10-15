# PIVNIK Evotor bridge — integration draft

## Foreground scan draft 1.0.10 (not installed or released)

The owner authorized preparing and publishing the update on 2026-10-15. The
connection screen now has a **network check without a key** first, and a separate
saved-key check. Network diagnostics neither read nor send the saved key.
`ConnectionCheck` accepts only the actual POS JSON refusal as proof of connectivity,
not an arbitrary proxy 401. The encrypted credential store and preference names
are unchanged; a compatible in-place update preserves the existing key.

`.github/workflows/evotor-bridge-apk.yml` tests/builds an unsigned release first,
without creating an APK signing key. Publishing then requires existing signing
secrets and the exact certificate fingerprint of the supplied installed 1.0.8.
Missing/mismatched signing identity blocks publication. Unsigned artifacts are
explicitly labelled **not for installation**. A compatible signed APK is published
on a new versioned `evotor-apk-1.0.10` branch without replacing older APKs or using
force-push. This does not upload or install the app through the Evotor portal.

The launcher opens `CustomerScanActivity`: add goods in Evotor, open PIVNIK,
scan the guest's QR with the register scanner, wait for confirmation, then use
“Вернуться к продаже” to return to the open SELL receipt. The activity receives
`ru.evotor.devices.ScannedCode` only while resumed, requires
`ru.evotor.devices.SCANNER_RECEIVER`, and restricts senders with
`ScannerBroadcastReceiver.SENDER_PERMISSION`. It uses the existing resolve/bind
and receipt UUID checks; it adds no product, discount or wallet operation.
One scan runs at a time. Results from a window left during the request do not
show a previous customer when the window is reopened.

The existing SELL barcode service is retained for compatibility, but returning
empty positions is **not** a documented way to stop Evotor's product lookup.
Neither supplied 1.0.8 nor 1.0.9 has a foreground scanner receiver. This draft
does not establish that network proxying works and does not implement spending.

Proxy diagnostics distinguish the two known code-2003 reasons: application not
applied to device versus destination unreachable. A timeout no longer tells the
owner to reinstall the application. No portal setting, production server, key,
database or installed application was changed. See `ops/EVOTOR-AUDIT-20261015.md`.

Ported selectively from `feature/evotor-pivnik-bridge` at
`2f6388a5ba04f8f95758eb31c1dc6ae0cbccdb18`. Not production-ready.

Flow (0.2.0): SELL barcode event → canonical QR resolve → recheck current
receipt UUID → receipt-specific binding → `POST /api/device/pos/receipts/bind`
with that UUID and the QR. The server accrues bonuses only when the closed
cloud document with the same UUID is imported, from that document's amount.
The app no longer registers receipt discount/edit services and writes no
`SetExtra`: it never touches the receipt, which also removes the PIVNIK tile
the till showed on the payment screen. It swallows only strict PIVNIK QR
formats, clears the binding after close or cancellation, and never carries a
previous receipt's client into a new one. If the bind call fails the bartender
sees «бонусы за этот чек не начислятся — отсканируйте QR ещё раз». Network
failures never block sales.

Authorization is now a separate device key, not a staff Bearer session.
See [BACKEND-CONTRACT.md](BACKEND-CONTRACT.md). HTTPS only, no redirects,
3-second network timeouts. Server token is stored encrypted with Android
Keystore; raw saved token is never displayed. Existing staff preference is
removed, so an approved app update requires explicit device provisioning.

## Build verification

`.github/workflows/evotor-integration.yml` runs JVM tests and compiles an
unsigned release. `.github/workflows/evotor-bridge-apk.yml` (push to the
integration branch or manual run) runs the same JVM tests and uploads a
**debug APK for a test install** as artifact `pivnik-evotor-debug-apk`.
Java 17, Gradle 8.9, Android SDK 35, Evotor integration-library `v0.6.40`.

When permanent signing secrets are absent, the workflow uses a throwaway debug
key. The uploaded 1.0.8 and 1.0.9 have different signing certificates and cannot
update each other normally. Preserve the installed app and find its existing
signing key before planning an update; do not uninstall a working register app
to work around signing. Old terminal firmware has an additional trust fallback:
the app bundles ISRG X1/X2 and GTS R1/R3/R4 roots (`res/raw/pivnik_roots.pem`) as a
fallback to the system roots.
The fallback is not proof of connectivity through the Evotor proxy. A permanent
compatible release signing key and real-device checks remain release gates.

## Hardware/external proof still required

After separate approval, use a test cash register and anonymized documents:

- open receipt, scan valid/unknown/revoked QR, verify current UUID after a slow response;
- cash and card, ordinary and manually discounted receipt; the empty scanner result must not interfere with checkout;
- the cloud REST SELL `id` must equal the SDK receipt UUID the app bound, otherwise nothing accrues;
- cancellation, no QR, two consecutive receipts, restart and delayed delivery;
- PAYBACK explicitly references the base SELL; repeat import leaves cash unchanged;
- Android Keystore save/read, endpoint change, revoke/rotate and recovery after lost issuance response.


SDK audit/history and sources remain in the original bridge branch README.

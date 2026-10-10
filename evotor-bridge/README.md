# PIVNIK Evotor bridge — integration draft

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

The debug APK is signed with a throwaway key generated in that run, so it
cannot update the installed 0.1.0 prototype in place: remove the prototype
first (it holds no data worth keeping; it was never configured), then install
1.0.6 (versionCode 10) and enter the `pvpos_…` key (the production HTTPS address is
pre-filled). Old terminal firmware that does not trust ISRG Root X1 still connects:
the app bundles ISRG X1/X2 and GTS R1/R3/R4 roots (`res/raw/pivnik_roots.pem`) as a
fallback to the system roots.
A permanent release signing key is a separate, later step; until then every
new test build is installed the same way.

## Hardware/external proof still required

After separate approval, use a test cash register and anonymized documents:

- open receipt, scan valid/unknown/revoked QR, verify current UUID after a slow response;
- cash and card, ordinary and manually discounted receipt; the empty scanner result must not interfere with checkout;
- the cloud REST SELL `id` must equal the SDK receipt UUID the app bound, otherwise nothing accrues;
- cancellation, no QR, two consecutive receipts, restart and delayed delivery;
- PAYBACK explicitly references the base SELL; repeat import leaves cash unchanged;
- Android Keystore save/read, endpoint change, revoke/rotate and recovery after lost issuance response.


SDK audit/history and sources remain in the original bridge branch README.

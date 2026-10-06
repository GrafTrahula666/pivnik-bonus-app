# PIVNIK Evotor bridge — integration draft

Ported selectively from `feature/evotor-pivnik-bridge` at
`2f6388a5ba04f8f95758eb31c1dc6ae0cbccdb18`. Not production-ready.

The existing receipt state machine is retained: SELL barcode event → canonical
QR resolve → recheck current receipt UUID → receipt-specific binding → SDK
`SetExtra` during receipt discount / edit events. It swallows only strict
PIVNIK QR formats, makes no price/bonus changes, clears binding after close or
cancellation, and never carries a previous receipt's client into a new one.
Returns inherit the client on the backend from an explicitly linked base SELL.
The persisted local binding has a 3-hour TTL. Network failures do not block sales.

Authorization is now a separate device key, not a staff Bearer session.
See [BACKEND-CONTRACT.md](BACKEND-CONTRACT.md). HTTPS only, no redirects,
3-second network timeouts. Server token is stored encrypted with Android
Keystore; raw saved token is never displayed. Existing staff preference is
removed, so an approved app update requires explicit device provisioning.

## Build verification

`.github/workflows/evotor-integration.yml` runs JVM tests and compiles an
**unsigned release**. It does not upload an installable APK, generate a signing
key, replace the installed app or access production. Java 17, Gradle 8.9,
Android SDK 35, official Evotor integration-library `v0.6.40` from JitPack.
`gradle :app:testReleaseUnitTest :app:assembleRelease`.

Before any approved APK update, independently verify the installed package,
versionCode, original signing certificate and durable signing-key backup.
The draft keeps the original prototype versionCode 1; do not install it as an
update. A CI cache is not a backup of a signing key. Android Keystore credential
keys and APK signing keys are different keys with different purposes.

## Hardware/external proof still required

After separate approval, use a test cash register and anonymized documents:

- open receipt, scan valid/unknown/revoked QR, verify current UUID after a slow response;
- cash and card, ordinary and manually discounted receipt: zero SDK discount must preserve amount;
- empty scanner result and trigger callbacks must not interfere with checkout;
- inspect closed SDK header and cloud REST SELL: exact Extras namespace/key and UUID;
- cancellation, no QR, two consecutive receipts, restart and delayed delivery;
- PAYBACK explicitly references the base SELL; repeat import leaves cash unchanged;
- Android Keystore save/read, endpoint change, revoke/rotate and recovery after lost issuance response.

Do not infer the cloud Extras schema from the Java writer. The backend leaves
it ignored until actual fixtures are reviewed. All/app dashboards and current
admin fallback do not prove the full scan→cloud→linked dashboard scenario.

SDK audit/history and sources remain in the original bridge branch README.

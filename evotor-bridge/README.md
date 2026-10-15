# PIVNIK Evotor bridge — integration draft

## Foreground scan 1.0.10 (hardware verification pending)

The owner authorized preparing and publishing the update on 2026-10-15. The
connection screen now has a **network check without a key** first, and a separate
saved-key check. Network diagnostics neither read nor send the saved key.
`ConnectionCheck` accepts only the actual POS JSON refusal as proof of connectivity,
not an arbitrary proxy 401. The encrypted credential store and preference names
are unchanged; a compatible in-place update preserves the existing key.

`.github/workflows/evotor-bridge-apk.yml` tests/builds an unsigned release first,
without creating an APK signing key. Publishing then requires existing signing
secrets and the approved permanent certificate fingerprint:
`36D73F80FB10E8EE2D2E7D1765AECFF5809405D202D700C609366C084F7F2663`.
Missing/mismatched signing identity blocks publication. Unsigned artifacts are
explicitly labelled **not for installation**. A permanent signed APK is published
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
unsigned release. `.github/workflows/evotor-bridge-apk.yml` builds the unsigned
release, then requires all four permanent EVOTOR signing secrets and the pinned
certificate. It never generates a fallback debug key. Java 17, Gradle 8.9,
Android SDK 35, Evotor integration-library `v0.6.40`.

The supplied 1.0.8 and 1.0.9 used different disposable debug certificates.
Their old CI run had no signing secrets and exported no keystore backup.
After checking the available backups, the owner authorized a new permanent key
and one reinstall on 2026-10-15. The new encrypted keystore and credentials are
backed up privately outside Git; downloading that backup and signing with the
restored key has been verified. The owner should also retain an independent
offline/password-manager copy and configure the same key in GitHub Secrets.

`node scripts/configure-evotor-signing-secrets.mjs --keystore FILE --credentials JSON`
checks the approved certificate before setting the four secrets using an
owner-authenticated GitHub CLI. Add `--check-only` for a local certificate check.
No secret is printed or passed on a command line. This connector cannot set
GitHub Actions secrets directly; successful private backup is not CI provisioning.

### One-time installation from 1.0.8 / 1.0.9

The new certificate cannot update either supplied old APK in place. First ensure
the POS device key is available for re-entry; removing the Android application
removes its local preferences and encrypted credential. Remove only **PIVNIK для
Эвотора**, then install the signed 1.0.10 APK through the terminal's supported
installation/distribution method. The package remains `ru.pivnik.evotor.bridge`.
A GitHub merge does not install an APK. Subsequent higher-version APKs signed
with this permanent key can use the ordinary update path.

Open PIVNIK and use **Проверить связь без ключа** before entering a POS key.
A network timeout is still a connectivity failure. After connectivity succeeds,
save the POS key and check it separately; then use the foreground scan flow above.
This is a diagnostic/scanner build with no real-device proof yet; bonus spending
is not implemented. Do not interpret successful signature verification as a
working network, closed-receipt accrual or completed cash-register integration.

Old terminal firmware has an additional trust fallback: the app bundles ISRG
X1/X2 and GTS R1/R3/R4 roots (`res/raw/pivnik_roots.pem`) alongside system roots.
This fallback is not proof of connectivity through the Evotor proxy.

## Hardware/external proof still required

After separate approval, use a test cash register and anonymized documents:

- open receipt, scan valid/unknown/revoked QR, verify current UUID after a slow response;
- cash and card, ordinary and manually discounted receipt; the empty scanner result must not interfere with checkout;
- the cloud REST SELL `id` must equal the SDK receipt UUID the app bound, otherwise nothing accrues;
- cancellation, no QR, two consecutive receipts, restart and delayed delivery;
- PAYBACK explicitly references the base SELL; repeat import leaves cash unchanged;
- Android Keystore save/read, endpoint change, revoke/rotate and recovery after lost issuance response.


SDK audit/history and sources remain in the original bridge branch README.

# Evotor direct Railway candidate — 2026-11-09 (UNSHIPPED)

## Scope and current evidence

This is an isolated Android APK candidate, **not** a server or production change.
Source baseline: `main@aa08a2e718cf30a415184f58b19e68a99de734f5`.
The previously installed API base is `https://139.100.238.159.nip.io/evotor`.
The new API base is the existing canonical POS backend at
`https://pivnik-bonus-app-production-df60.up.railway.app`.

The owner confirmed three **existing** provider proxy allowlist entries for
`/api/device/pos/qr/resolve`, `/api/device/pos/receipts/bind`, and
`/api/health` under the direct Railway domain. This is evidence of configuration,
**not** proof the physical till's Evotor cloud proxy can reach Railway.
An external GET to Railway /api/health is also **not** an Evotor-terminal test.

## Exactly what changes

- `BridgeSettings.DEFAULT_API_BASE` selects direct Railway; POS endpoints and
  request headers/body/timeout rules are unchanged.
- A device already provisioned on Selectel has its v2 encrypted POS key sealed
  using the exact Selectel URL as AES-GCM AAD. The candidate decrypts it with
  the same non-exportable Android Keystore alias and writes a separate v3
  ciphertext with the exact Railway URL as AAD.
- Original v1 and Selectel v2 ciphertext/IV slots are preserved verbatim.
  A damaged/incomplete newer slot fails closed; it never revives an old identity.
  A failed v3 durable write does not destroy old persistent records.
- Fresh key provisioning into empty storage remains optional and is not shipped
  in public APKs. The private key is never added to source, artifacts, or logs.
- Version 1.0.19 / code 23 is higher than source 1.0.18 / code 22.
  **This does not prove which APK/version/certificate is installed on the till.**
- No changes to receipt UUID binding, checkout/redemption, financial logic,
  POS API, server, VK gateway, Caddy, database, patch chain or production env.

## Gates before real installation (BLOCKED until verified)

1. JVM crypto/Android unit tests and unsigned release assembly on exact PR head.
   Full root release gate: materialize twice (idempotency), `node --test`,
   `npm run check`, dependency audit; any CI failure blocks promotion.
2. Build signed APK from the permanent Evotor PKCS12 certificate **only**:
   `36D73F80FB10E8EE2D2E7D1765AECFF5809405D202D700C609366C084F7F2663`.
   Verify `apksigner` identity and exact candidate versionCode 23. Keep private
   signing material outside GitHub source, CI artifacts, and public PR comments.
   Do not invent a replacement certificate.
3. Confirm actual device package versionCode, app identity, and installed signer.
   Do not uninstall or clear the old APK or its encrypted preferences.
   Keep a copy of a verified original signed APK as rollback.
4. **Warning: this branch is unmerged and unverified on physical hardware.**
   Never recommend installing it on the bar till before explicit hardware
   acceptance and controlled owner-approved test. Selectel remains live.
5. Real Evotor v2 cloud proxy check on device: unauthenticated network check
   must return our expected POS 401, not arbitrary proxy 401; then authenticated
   saved-key check. Confirm QR resolve, receipt UUID bind, and a closed synthetic
   sale with exactly one appropriate cashback; also check unknown/revoked QR.
   No monetary redemption/spending until separately accepted.
6. If direct Railway is unreachable through the physical till, **do not**
   install the candidate. Investigate provider-side DNS/TCP/TLS/URL mask.
   External browser health cannot substitute for that result.

## Rollback

The prior signed APK retains Selectel as its fixed base. The v2 slots and
Android Keystore alias are not deleted or overwritten. A rollback must use
the same signer and respect Android's normal versionCode/downgrade restrictions:
installing a lower-code old APK over a higher-code one is normally blocked.
Before any hardware cutover, prepare an explicitly versioned rollback build
from the unchanged old routing with the same signer and a higher versionCode,
or another verified rollback path that preserves app data. **Do not uninstall
or clear data to force a downgrade.**

## Security

The existing permanent signing key is backed up privately; its public
certificate was independently compared with the approved fingerprint.
Neither `pvpos_` nor JKS passwords are stored in this PR.

# Evotor Selectel rollback APK 1.0.20 / code24 (UNSHIPPED)

This branch starts from unchanged production `main@aa08a2e718cf30a415184f58b19e68a99de734f5` and changes only
Gradle version metadata plus unsigned CI artifact provenance. **The POS URL
remains Selectel**, the old `DeviceCredentialStore` still decrypts its v2
ciphertext using the exact Selectel AES-GCM AAD, and the Android Keystore alias
and all POS financial/scanner code remain identical to the current 1.0.18 source.

Reason: Android normally refuses a lower `versionCode`. A future test install
of direct Railway 1.0.19/code23 should not require uninstalling or clearing the
till's data to return to the existing Selectel route. Code24 can be used only
as a verified same-signer rollback candidate.

Do not install this draft on a real bar till. Before using it:
- Compare installed real package versionCode and signer; code24 must be higher.
- Run exact-head JVM + Android compile + main release regression.
- Sign with the existing PIVNIK Evotor Release certificate, fingerprint
  `36D73F80FB10E8EE2D2E7D1765AECFF5809405D202D700C609366C084F7F2663`.
- Validate exact package/versionCode/signature with `apksigner`.
- If direct Railway trial has already replaced or revoked the device key,
  **do not** blindly roll back to stale v2 credentials; confirm the old key
  remains accepted. This candidate does not restore a revoked key.
- Retain data; never uninstall or clear prefs to force a downgrade.

No install, server/DB/Selectel configuration changes or signing secrets added
to Git. Original Selectel remains live until separately approved removal.

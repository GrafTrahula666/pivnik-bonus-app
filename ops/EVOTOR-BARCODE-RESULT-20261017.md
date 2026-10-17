# Native loyalty barcode completion — 1.0.14/code18 candidate

The owner reproduced the problem on installed 1.0.13: scanning a real
`PIVNIK:` QR in native Sale opens the PIVNIK guest card, then the terminal
reports that no product with that barcode exists. The separator was confirmed
as a colon; QR parsing, scanner delivery and network configuration are not
the failing stage demonstrated by this reproduction.

The old `NativeCustomerActivity.finish()` returned zero positions and zero
position groups. In the official integration-library v0.6.40 that omits
`extra_positions_list_count`. `LoyaltyBarcodeResult` now returns one empty
position group for recognized PIVNIK codes. It sends group count1 and subgroup
position count0, without inserting or creating a product. Other codes retain
the old no-match result, and the service still ignores product-creation events.

This is a targeted compatibility candidate, not proof that the closed-source
native POS will consume an empty group. The official SDK documents grouped
results for POS versions above6.35. Older POS ignores them; native handling
of an empty group is not specified by the public SDK. Do not claim suppression
of the native error until a physical scan confirms it. If POS rejects this
shape, do not add a fake product or claim product-creation support as a workaround.

`LoyaltyBarcodeResultTest` executes actual SDK Bundle encoding/decoding and
Android Parcel round trips under Robolectric. It distinguishes zero groups
from one empty group, proves no receipt positions or creation offer are
serialized, and retains ordinary product/invalid-code fallback. It does not
emulate native Sale or prove hardware acceptance.

Acceptance: update over1.0.13 with the same permanent certificate, open Sale,
add a real item, scan the customer QR, verify the customer/balance, press
«Продолжить продажу» (also check Android Back), and verify no product-not-found
error and no new receipt line/price change. Also scan an ordinary product.
No fiscal sale is needed for this scan acceptance. Monetary redemption remains
default off until its separate controlled native receipt acceptance.

Server routes, credentials, encrypted preferences, signing identity, database,
financial policies and the cloud receipt worker are unchanged. Updating this
APK does not require uninstalling or entering the device key again.

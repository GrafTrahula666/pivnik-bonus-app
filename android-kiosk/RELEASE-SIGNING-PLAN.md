# Android kiosk release signing plan

## Goal

Preserve the signing identity that already updates the installed PIVNIK kiosk application successfully. Do not replace it with a newly generated signing key unless a deliberate factory-reset migration has been approved.

## Current verified fact

A newer kiosk build has already been installed over the existing application on the real device without uninstalling it or performing a factory reset. Treat the signing identity used for that successful update as the release identity to preserve.

## Release rules

1. Before any kiosk release, verify that the candidate APK has the same signing certificate fingerprint as the currently installed application.
2. Never publish or deploy an APK signed with a different identity to the real kiosk as a routine update.
3. Do not store the only usable signing material in a CI cache, a single workstation, or a single cloud account.
4. Maintain at least 2-3 independent protected backups of the signing material and the information required to use it.
5. Do not commit keystores, passwords, private keys, or recovery material to this repository.
6. Test update-in-place on a non-production device or controlled target before updating the bar kiosk.
7. If the release identity cannot be recovered or verified, stop the release. Do not solve the problem by silently generating a new key.

## Recovery / verification checklist

- Identify the certificate fingerprint of the APK currently installed on the kiosk.
- Identify the signing configuration used by the last APK that successfully updated it in place.
- Confirm both fingerprints match.
- Confirm protected backups exist in at least 2-3 independent locations.
- Confirm the backup can actually be restored and used to sign a test artifact.
- Record only non-secret fingerprints, ownership/responsibility, and recovery procedure in project documentation.

## PR #165

Kiosk shifts must not be deployed from an unmerged or draft branch to the real device. When PR #165 is refreshed onto current `main`, re-run the Android build/unit checks and the repository regression gate before considering a kiosk release.

This document intentionally contains no secret values.

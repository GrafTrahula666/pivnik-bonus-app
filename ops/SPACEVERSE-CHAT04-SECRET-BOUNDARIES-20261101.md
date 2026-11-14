# SPACEVERSE · Chat 04 checkpoint 36 — server-side secrets, masking and key boundaries

Date: 2026-11-01. Task **36/40**. Based on confirmed `origin/main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`; changes in isolated `spaceverse/chat04-secret-boundary-regressions-20261101`.

## Sources and existing production behavior

Read `ops/MODULE-MAP.md`, including the `Do not break` contract and the 009 integration / 015 POS proxy descriptions. Audited:
- `admin-platform/server/onboarding-secrets.ts`: one reusable server-side AES-256-GCM envelope; validates 32-byte base64 keys from environment, max 5 IDs, active + previous key support, 96-bit random IV, 128-bit auth tag, authenticated context (AAD), keyed HMAC command fingerprint, timing-safe comparison; no insecure plaintext fallback.
- `admin-platform/server/venue-onboarding.ts`: Evotor integrations persist encrypted envelope, key ID and HMAC fingerprint under draft/store context; authenticated masked API response; rotation rewraps on successful verification, with read/write scope checks and audit.
- `admin-platform/server/onboarding-pos-proxy.ts`: same cryptographic box for encrypted device key with exact runtime/company/venue/store/terminal context; no plaintext in API/audit; reads require tenant-owned scope.
- `admin-platform/src/phaseC/VenueOnboarding.tsx`: password-type token field, clears token after successful save/reopen, displays `••••••••` only on existing integration; no echoed saved token.
- Existing `admin-platform/server/tests/venue-onboarding.spec.ts` checks encryption, credential masking, HMAC replay, key rotation, missing keyring and tampered ciphertext. Existing `onboarding-pos-proxy.spec.ts` exercises masked state and absence of device key in response/audit.

These are existing features. No production gap justifies replacing the central encryption service or creating a second key store.

## Increment in this PR

New isolated pure-unit regression `admin-platform/server/tests/onboarding-secret-box.spec.ts` checks:
1. AES-GCM different nonces, ciphertext not raw plaintext, and authenticated isolation when company, venue, store or provider AAD changes.
2. Tampered ciphertext/tag and empty context fail closed with sanitized `503 ONBOARDING_SECRET_KEY_UNAVAILABLE`, no credential text in error.
3. Active+old keyring can read v1, rewrap with v2, then safely retire v1; removing v1 before rewrap makes the old envelope unreadable.
4. Unconfigured, noncanonical, insufficient, too-many or wrong-active keyrings fail closed; never fallback to plaintext.
5. HMAC canonical fingerprints are scope-sensitive, authenticated, and compared via the production timing-safe utility.

All fixtures use synthetic constants passed via function arguments; no process environment, production DB, secret variables, ciphertext records or runtime code modified.

## Gate / integration

File creation and diff review only at checkpoint time; exact-head CI `Pivnik release gate` including Business Vitest + double materialize + JS tests + dependency audits, and any triggered browser/PostgreSQL workflow still require verification. No local git checkout in this session; do not claim direct `npm` runs. Existing modules and public API unchanged, so `ops/MODULE-MAP.md` remains accurate and is not edited in this test-only PR.

Handoff to Chat 01 through Draft PR; no merge, deploy, secret rotation, env change, device update or production writes. Next numbered step **37** (disposable tenant database bootstrap) remains separate.

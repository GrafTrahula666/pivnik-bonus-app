# CHAT_06 / task 52: unmounted licensed fiscal read (checkpoint)

**Base main:** `c92ed7cd65f1a96d94363c2b7e212424ab078a73`; **source contract:** Draft PR #327 (task 51, release gate passed).
**Branch:** `spaceverse/chat06-evotor-licensed-reader-20261101`.
**Scope:** a new read-only server adapter and a synthetic negative test, no route, no migration, no env changes, no POS code, no production access or deployment.

## Behavior prepared, not commercial activation

`admin-platform/server/evotor-market-document-reader.ts` adds `readLicensedEvotorDocumentPage`, one fixed Cloud REST V2 GET page (`SELL,PAYBACK`, bounded `since/until`); it never accepts an arbitrary URL, import command or arbitrary client token. The only server-side credential is retrieved as encrypted `admin_evotor_market_users` bytes **inside** `withEvotorPaidLicenseGuard` with exact company/venue/provider/store/binding `ready` checks and decrypted with the existing Evotor Marketplace keyring/AAD. A fresh full guard is run **after** the provider GET and validation so mid-flight revoke, inactive owner, token rotation or lost license denies the result. API errors, redirect, non-JSON, malformed provider payload, unrecognized type, foreign store and oversized content fail closed; no secret or internal error text is returned.

A trusted server-owned `normalizeDocument` callback is required. Reuse the established `pos/evotor-document.js:normalizeEvotorDocument` projection when the eventual standalone runtime packaging is designed; **do not** import the legacy PIVNIK importer or create a parallel amount calculator. The adapter returns only explicit normalized fields (not raw cloud payload, customer phone, extras or OAuth token). The `hasMore` signal means only that this page had an opaque next cursor; it **cannot** establish complete history. Cursor iteration is specifically task 55.

**Critical default deny:** The current production schema from migration 024 supports only `pending/hold/revoked`, no `ready` state. The existing license issuer/paid policy is unmounted and the official licensing unit has not been verified; therefore this code is **not a usable live read**. Never relax the production CHECK merely to enable this adapter. The synthetic test's policy and credential are fixtures, not provider authorization.

## Verification

- Inspect actual diff and GitHub release gate on the precise new PR head.
- `server/tests/evotor-market-document-reader.spec.ts` tests exact GET, absence of leaked identity and secrets, pending/hold/revoked, foreign tenant/venue/store/session/owner, unapproved license, mid-fetch revocation/rotation, bad provider payload, incomplete page and invalid periods. Its guard is mocked **only to exercise orchestration**; native PostgreSQL coverage of `withEvotorPaidLicenseGuard` already exists in `evotor-market-license-guard-postgres.spec.ts`. Never claim that a mock verifies actual canonical authorization.
- Local checkout/git commands and `npm run materialize` twice, `node --test`, `npm run check`, `npm audit`, Business `build` not available in this session's tool environment; GitHub CI evidence must be inspected separately and not confused with a local run. No live test store or real financial transaction used.
- No root `server.js` or `universal-server.js` route modified. No shared `ops/MODULE-MAP.md` edits (this isolated unmounted adapter is described here; avoid concurrent changes to the shared global module map by other chat agents; coordinator must integrate documentation on promotion).

**Status:** TASK 52 `PREPARED / BLOCKED for verified production-enabled integration`; synthetic tests/CI subject to exact-head confirmation. Do not move to task 53 until the scoped acceptance gate has been explicitly evidenced or the external blocker has been recorded with safe work remaining.

**Next small step:** evaluate CI including Business build/typecheck of this unmounted module, add native disposable-PostgreSQL adapter coverage where possible, verify official provider docs and authorized test-store rights, then hand Draft PR to CHAT_01. No merge/deploy/production writes.

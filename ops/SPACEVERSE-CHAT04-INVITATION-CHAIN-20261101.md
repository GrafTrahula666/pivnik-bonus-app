# SPACEVERSE · Chat 04 checkpoint 35 — invitation TTL, single-use and revocation

Date: 2026-11-01. Only queue item **35/40**. Source base: `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.

## Verified current implementation

Reviewed `admin-platform/server/onboarding-invitations.ts`, `onboarding-access.ts`, `InviteAcceptance.tsx`, `OnboardingInvitations.tsx`, HTTP tests, browser invitations E2E, `ops/MODULE-MAP.md` and its `Do not break` contract. No conflicting open invite PR/branch found at audit.

- Optional invitation feature is default-off. Issuer scope comes from server ownership/grants, not client role/company claims. Creation stores a hashed, deterministically replayable single-use token; TTL must be an integer 1–168 hours; changed-payload replay yields 409.
- Acceptance locks the invitation, refuses revoked/expired/consumed tokens for another account, checks that the original issuer **still** owns the target, and atomically creates a grant or rolls back. Same accepting logged-in user may safely replay. Revocation locks the invite and revokes the associated grant, denying future authorized draft operations. Point-only grants do not expose adjacent points.
- Existing tests cover the direct paths but did not independently prove **transitive revocation**: a pending secondary invite issued by a newly invited organization owner should become non-claimable when that upstream owner's grant is revoked.

## This iteration

Added two focused signed HTTP and disposable database regressions in existing `admin-platform/server/tests/onboarding-invitations.spec.ts`:

1. SUPER_ADMIN creates a one-hour organization-owner invitation; the accepted owner issues a second manager invitation; SUPER_ADMIN revokes the original owner grant twice (idempotent). Attempting to redeem the secondary link must fail 403 `INVITATION_OWNER_REQUIRED`, no new account or grant is written, the secondary invite remains unclaimed, and the original owner cannot issue another invitation or retain onboarding capability.
2. Values 0, -1, 169, 1.5, 24.1 hours must fail with 400 `INVITATION_INVALID` and not create a DB invite row. Existing tests continue to cover valid TTL, one use, replay, credentials, revoke and viewer role.
  
No runtime/API/SQL/schema/migration/env/secret changes. The test uses disposable PGlite and real signed local HTTP. It is not proof of concurrent native PostgreSQL acceptance races.

## Verification and integration

At creation, GitHub PR-head CI has **not yet been confirmed**. Required: `Pivnik release gate` including materialize twice, JS syntax/root tests, Business Vitest and dependency audits; optional browser/Postgres checks. No local checkout is mounted; do not claim local runs. If failed, fix only this test/security task. Draft PR remains unmerged; Chat 01 coordinates integration. No production, Railway, or kiosk changes. Next queue item is #36 secrets, only after #35 tests/review.

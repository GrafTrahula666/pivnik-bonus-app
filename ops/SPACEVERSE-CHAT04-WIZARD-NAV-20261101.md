# SPACEVERSE · Chat 04 checkpoint 32 — in-page wizard navigation

Date: 2026-11-01. **Task 32 only**, after source-audit checkpoint 31 in Draft PR #328. Isolated base: `origin/main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`. Branch: `spaceverse/chat04-wizard-navigation-20261101`.

## User problem

Existing `VenueOnboarding.tsx` already hosts the single onboarding flow, but forms and read-only/status modules appear as a long vertical sequence. The server `OnboardingProgress` provides authoritative states, yet there was no short path to the corresponding UI section. The owner must scroll through many sections and may mistake an individually confirmed provider step for a launched venue.

## Small reversible change

- Added a compact **in-page section index** to `VenueOnboarding.tsx`, shown only when editing. All navigation actions are plain same-page anchor links, no API calls/state mutations. The index exposes links only for **currently mounted** sections and respects existing capabilities, role/write gates and CRM-only vs guest-app mode.
- Linked existing progress, venue data, owner support, CRM read, CRM activation diagnostic, guest application settings, canonical company/venue scope, existing isolated database/schema preparation, Evotor integration, optional POS proxy and legacy invitation. No second master, account onboarding model, credential form, registry, route, DB migration or feature flag.
- Each target has a stable single `sv-onboarding-*` ID. No section, field, action, error message or recovery path was removed or hidden; all sections remain rendered in their original order.
- Added compact dark-minimal link styling, responsive horizontal touch scrolling at narrow widths, 40px touch targets, keyboard focus outlines and anchor scroll-margin; there is no new dependency.
- Extended the **existing** desktop/mobile `venue-onboarding.spec.ts` browser scenario: navigation appears for a new draft, links appear after proper server confirmation, navigation reaches DB section, Evotor token input remains singular, and unauthorized owner has no wizard/nav.

## Ownership and safety

- Original session/CSRF/tenant checks, idempotency/revision, audit, hidden credentials and server-owned statuses stay unchanged. `active` for a provider step never changes `runtimeStatus:'not_provisioned'` or `published:false`.
- This PR changes only `admin-platform/src/phaseC/VenueOnboarding.tsx`, its existing CSS and existing E2E; checkpoint documentation is additional. No `server.js`, `universal-server.js`, SQL, env, `apply-*.mjs`, production or Railway modification.
- `ops/MODULE-MAP.md` is unchanged **intentionally**: component responsibilities, routes, data models, module boundaries and do-not-break invariants are unchanged; only existing section navigation is enhanced. No patch-chain scripts were modified.
- The link list does not imply all steps are complete: current pending/unavailable components and their warning text are preserved. Failed steps remain actionable only through their already authorized flows.

## Verification / status

**Source diff and ID/href uniqueness:** the authoring script checked one exact occurrence for each replaced snippet; every navigation href has a matching target ID, and all IDs are distinct.

**Not yet executed in this session:** root `npm run materialize` twice, `node --test`, `npm run check`, `npm audit`; Business `npm run typecheck`, `npm run lint`, `npm run build`, unit/Playwright desktop/mobile. Current environment does not contain a repo checkout; GitHub API can read/write but cannot execute these scripts. **The new tests are written, not passed.** CI status must be read from the exact PR head before coordinator review/merge. No production E2E was attempted.

## Next continuation

Stay on **task 32** until tests and review confirm it. If checks fail, repair only this UI/nav and its tests in the same Draft PR; do not start item 33. When task 32 passes, hand off to Chat 01 for integration and proceed to task 33 separately. No autonomous merge/deploy/activation.

# SPACEVERSE · Chat 04 checkpoint 34 — canonical venue scope isolation

Date: 2026-11-01. Task 34/40. Base `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`. Isolated Draft PR branch `spaceverse/chat04-venue-scope-status-20261101`.

## Observed baseline

- The current `VenueOnboarding.tsx` creates a new venue in a chosen company through existing saved draft and explicit scope; the creation transaction, revision, role/ownership checks and `active=FALSE` are in `server/venue-onboarding.ts`. The separate `OwnerVenues.tsx` list allows selection of an *existing* authorized venue or resuming its existing draft. The wizard does **not** adopt a previously active venue as a new scope, which should not be added without a separate source-of-truth/migration design.
- `scopeIsConsistent` already rejects company/venue mismatch and premature `venue.active` on the explicit `GET .../scope` response. However `server/onboarding-workflow.ts` joins `venues` on company but interpreted the resulting NULL `venue_active` on a mismatched binding as ordinary pending; only `TRUE` was reported as inconsistent. Its optional POS projection could throw 503 for the same malformed scope instead of rendering a consistently failed step.
- `server/onboarding-venues.ts` exposed `s.venue_id` in the owner list before validating the joined venue company or inactive state. In a corrupt/misbound scope, an unrelated venue ID could be included even though the join did not match.
- Owner/company/venue access is still server-side and roots use `onboardingDraftAccessSql`. No proven access-bypass or production corruption was observed. This is defense-in-depth against metadata drift and failure-state misrepresentation.

## Narrow change

1. `onboarding-workflow.ts`: when scope has a venue ID, require an actual matching inactive venue. Missing/misbound or active means step `venue.status='failed'`, `code='scope_changed'`, aggregate `failed`, `runtimeStatus='not_provisioned'`, `published:false`; skip POS source projection for an invalid venue.
2. `onboarding-venues.ts`: include the prepared `venueId` in the API response only if the canonical joined venue is in the same company and still inactive. Retain an internal joined-venue ID to prevent an accidentally activated matching prepared venue from also appearing as a separate legacy row; do not suppress a legitimate foreign active venue on a mismatched link.
3. `server/tests/onboarding-workflow.spec.ts`: one signed HTTP + disposable SQL regression that swaps a prepared scope onto a venue in another company, verifies explicit scope endpoint rejects it, verifies `progress` and owner list expose failed state (no foreign venueId), tests premature activation, and restores the fixture rows in `finally` blocks.
4. `ops/MODULE-MAP.md` updated alongside the modified backend modules.

No routes, auth grants, schema, migration, DB registry, runtime launcher, POS credentials, kiosk or deploy settings have changed. Existing healthy prepared venues stay inactive/pending; existing authorised-venue selection keeps using the canonical owner list.

## Testing and acceptance

Source checks completed: exact-match guarded file edits and required `Do not break` map inspection. **Pending exact head CI**: `release-gate.yml` materialize twice, syntax, root test suite, Business Vitest, dependency audits; browser and PostgreSQL CI where triggered. The disposable PGlite fixture is not proof of native PostgreSQL race behavior. Manual real-world preview and independent `lint`/typecheck are not established until tested.

### Handoff
Pass the Draft PR and CI evidence to Chat 01. No merge/deploy/production writes. Do not start task 35 until this task passes technical review.

# SPACEVERSE · CHAT 09 · Пункт 85: multi-venue comparison

**Baseline:** `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
**Branch:** `spaceverse/chat09-venue-comparison-20261101`. Draft only, no merge/deploy.

## API

`GET /api/admin/venue-comparison?venueIds=101,102&date=2026-10-02`

Up to six unique authorized venue IDs. `date`, `from/to` and `days`
are parsed by the existing Evotor Moscow calendar period helper, so all
venues share exact `[from,to)` boundaries.

Authorization is **per venue**, with the authenticated session's
`resolveVenueScope` and `requireVenueAccess(GET,pos)`. The call fails
as a whole for unknown, inactive, inaccessible or cross-company venues,
even for SUPER_ADMIN. No POS read begins until all checks complete.

Each venue is read via existing tenant+location-bound Evotor store mapping,
in one repeatable-read read-only transaction. A failure rolls back the
entire query. The projection returns only venue IDs/names/codes, connection
state, optional last successful sync, signed minor-unit money strings,
SELL/PAYBACK document counts, and nullable fiscal receipt counts.
No customer identity, QR, PII, raw receipts or loyalty ledger is included.
No modifications to existing single-venue API or report data.

Missing connection or first successful sync -> per-venue amounts `null`.
Connected empty import may return `0`, but does not prove provider history
completeness; `coverage=imported_read_model_only`.
Since authoritative ISO currency is absent from the snapshot, the response
explicitly has `currency:null`, `comparableMoney:false`, `total:null`.
No sum, FX, delta or rank of different venues' money is claimed.

## Tests and merge boundaries

`admin-platform/server/tests/venue-comparison.spec.ts` covers ID/input
bounds, duplicate rejection, full-request authorization and no-before-auth
POS fetch, cross-company denial, error rollback, precise negative monetary
strings, unknown-vs-zero, and actual company-access SQL in disposable PGlite.

Before merge: release materialization twice, Node tests, Business Vitest,
typecheck, lint, build, audits and browser flow should be reviewed from
exact-head CI. The tool session does not contain a local Git checkout;
do not claim local tests ran. Live provider/production E2E not performed.

PRs #332/#344/#348/#354 are independent Drafts, not in main.
This slice touches the router, not their shared Evotor read adapter.
CHAT01 owns review, conflict resolution and integration. Next task #86
concerns presentation; it is not part of this change.

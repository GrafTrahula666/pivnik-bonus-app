# CHAT 09 / 84: verified customer identity cohorts

Baseline main: `c92ed7cd65f1a96d94363c2b7e212424ab078a73` · Branch: `spaceverse/chat09-verified-customer-cohorts-20261101`.
**Draft only**, no merge/deploy/production writes.

`verifiedCustomerCohorts` is an additive aggregate in the existing
venue-authorized Evotor POS report, after the exact company+venue store
binding and successful sync check. Only explicit QR-confirmed
`pos_customer_links`, active unmerged users and single-fiscal-print SELL
documents qualify. No amount/time/name/phone inference and no identities
returned in output. Refunds do not establish a new buyer. Strict
`[from,to)` bounds in UTC; older verified links may establish true returning
buyers **within the observed same-store history**, not globally.

Definitions:
- `verifiedBuyers`: distinct confirmed linked SELL buyers in period.
- `firstObservedInPeriod`: no earlier verified linked SELL found in that store.
- `returningFromEarlierObserved`: at least one confirmed linked SELL earlier.
- `repeatWithinPeriod`: two or more confirmed linked SELL during period.
  Overlaps `firstObservedInPeriod`; never sum these two counts.
- `newCustomers:null`, `firstPurchaseEverKnown:false`: imported history is
  not proven complete from first ever purchase. This is NOT customer DAU.

PGlite tests: prior purchase, two within period, unverified prior receipt,
other store, deleted and merged identities, split print, PAYBACK and upper
bound. Schema, binding or sync unavailable -> null cohort object.
The old POS summary API is unchanged. No migration or client identity export.
Test results not claimed until GitHub Actions on exact head passes.

Next task 85 multi-venue comparison, separate reviewed branch.

# Fresh Evotor documents must not wait for historical synchronization

On18October2026 the owner completed cash sale45109 for100rubles at14:11MSK.
The device resolved and bound its customer successfully before payment. At14:25
the official exact-document API and the recent-document API returned the closed
SELL with the same receipt UUID and CASH100; our document table still ended at
sale45108. The historical importer repeatedly stopped with `invalid_response`.
There was no accrual for that claim at that observation, so key acceptance alone
was not evidence that the complete payment/accrual flow worked.

`syncEvotorRecent` imports an overlapping two-day created-document window before
historical synchronization. It uses the existing configured-store guard,
normalizer and immutable snapshot conflict rule. The common document import is
extracted from `importEvotorPage` without changing its SQL. Recent ingestion has
its own bounded page budget and advisory lock; it never updates history cursor,
scan-until, completion or error fields. Historical scanning remains responsible
for older and delayed documents outside the window. Truncated recent scans report
`complete:false`; this does not claim historical completeness.

Only actual closed cloud documents can enter `pos_documents`. The identity comes
from the exact original receipt claim. This importer never changes wallets,
transactions, claims or bonus calculations. Existing bonus processing decides a
closed document once with the same receipt/user locks and request key.

The serving main code calls the recent import before its existing sync/bonus
cycle. The separate already-operating maintenance cron is updated with the same
modules and recent-first call, retaining the existing history worker, environment,
schedule and canonical redemption-aware normalizer. Main rollout is separate;
updating that cron does not claim that a new root commit is already deployed.

Validation covers failed historical cursor isolation, exact replay, page-budget
and cursor progress, cross-store rollback, changed financial data rollback,
initial-only since filtering and zero wallet/transaction writes. A fixture of
the complete deployed function additionally verifies that recent import runs
before a malformed historical page and diagnostics still complete on failure.

Actual owner sale accrual and duplicate count must be read back after ingestion;
fixture balances must never be reported as production results. Temporary detailed
acceptance logging is removed after observing the real result. Next-buyer identity
clearing and actual redemption remain separate physical acceptance checks.

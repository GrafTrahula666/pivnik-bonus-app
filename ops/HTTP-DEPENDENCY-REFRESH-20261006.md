# HTTP dependency refresh — 2026-10-06

Base: verified `origin/main` `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`.
Existing implementation reviewed: PR #209, commit `c591dfc0ce9d8c2478f35923fed336d023cbd3ef`.
This stage selectively reuses its six lock entries and two existing dependency
minimums. Its POS code, check commands and unrelated root-version metadata are
excluded. No new dependency, environment variable or service is introduced.

The confirmed main audit has 3 moderate, 2 high and 1 critical finding; #212's
release gate fails its production dependency audit. This is a dependency
finding, not proof of production exploitation. The source has no explicit
Express `trust proxy` configuration.

| Package | Main | Reviewed replacement |
|---|---|---|
| body-parser | 1.20.6 | 1.20.8 |
| compression | 1.8.1 | 1.8.2 |
| express | 4.22.2 | 4.22.3 |
| proxy-addr | 2.0.7 | 2.0.8 |
| qs | 6.15.3 | 6.16.0 |
| source-map-js (dev) | 1.2.1 | 1.2.2 |

## Verification

- Clean `npm ci --ignore-scripts` succeeds with the selected lockfile.
- Full `npm run materialize` twice: 393 tracked files byte-identical.
- Materialized `node --test`: 438/438; `npm run check` passes;
  added HTTP test file also passes `node --check`.
- Fresh `npm audit`: zero findings across all severities.
- Optional pre-materialize run: 24 source/render failures. All 24 also fail
  in an isolated unchanged main archive using the old dependencies (that
  archive has 25 failures total). No new failure name; the required
  materialized suite is green. No unrelated source fixes included.
- Public read-only `/api/health`: Telegram and VK both return HTTP 200 JSON
  on 2026-10-06. Deployed dependency versions and authenticated workflows
  remain unverified.
- A regression fixture confirms proxy-addr 2.0.7 accepts an unrelated IPv4
  proxy for `::ffff:10.0.0.0/8`. The replacement rejects ordinary and mapped
  unrelated IPv4 candidates for both short and proper mapped prefixes while
  preserving a valid trusted address.
- Local Express/compression HTTP fixture: gzip success and repeat, 403,
  malformed JSON 400, simulated upstream failure 502, premature stream close
  and a subsequent successful request. This verifies transport behavior, not
  application authorization or a quantified native-memory leak test.
- Generated materialize changes restored only in this isolated worktree;
  no route or UI change is proposed, no patch script retired.
- All other working copies, including foreign dirty assets/runtime files,
  were inspected and preserved. Open PR heads inspected; #209 remains separate.

## Existing product inventory (carry-forward, no feature rebuilt)

| Function | Existing implementation | Evidence | Concrete gap | Next bounded step |
|---|---|---|---|---|
| Cash/Evotor | #174, #176, #209, #210 | Draft code and #209 exact-head CI; prior isolated return/replay checks | Production sales correctness and sync not proven | Review one scoped sales workflow |
| CRM directory | main, #208 | Directory access-state tests and desktop/mobile fixtures | Card transition absent in main | Existing scoped card integration review |
| Customer 360 | #96, #115, #212 | #212 19 signed-token/HTTP/SQL fixtures | Full router, browser, production schema and tenant wallet ownership unproven | Review composition without enabling writes |
| Bonus corrections | main, #193, #199 | Prior SQL atomicity and replay checks | Full tenant-owner UI workflow unproven | One isolated workflow verification |
| Telegram campaign | main campaign store/provider | Existing automated tests | Provider delivery not verified; no attribution evidence | Preview/test-send workflow review without bulk send |
| Achievements/frames | main issuance modules | Existing suite | Tenant-sensitive manual issuance audit incomplete | Trace one existing issuance action |
| Audit/rights | membership modules, #195–#197 | Prior scoped read and journal fixtures | Production tenant isolation not established | Full routing composition proof |

Knowledge-base document reviewed previously; exact `starter-pack.md` was not
found. No production identity, real user data or database was used. Public
health cannot establish deployed package versions or the working admin flow.
No merge or deployment performed. Benefit for owners: a reviewable security
update independent of the unfinished cash integration; no new UI feature is
claimed. Next: inspect the new exact-head CI before any further stage.

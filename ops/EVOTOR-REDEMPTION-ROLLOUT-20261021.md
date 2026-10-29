# Evotor redemption rollout — 2026-10-21

Owner mandate: make POS bonus spending ready by the bar opening. Work started
from main0d7314c735ec636091e50dab4aecb3d96dd2bf88. Read-only production preflight:
main deployment6ca4d156-eb64-461a-ab99-a1331079966aSUCCESS; redemption flag absent
(defaultOFF), schema023 present, one active store device, no existing holds.

Rules stay unchanged:1point=1₽, whole points, up to30% receipt and actual available
balance. Reserve debits available balance once; native checkout applies a ruble
discount; cloud close confirms the actual net/effect. Cashback uses the actual
paid remainder; paid beer volume retains the existing separate canonical policy.

## Release

- Manually apply additive025 while reservations remain OFF. It adds only a
  nullable JSONB cloud-effect sidecar; no default zero, money write or snapshot
  rewrite. Keep normal imports and all financial locks.
- Deploy the reviewed canonical importer/worker and update the existing sync
  function's two canonical source modules, preserving its recent-first scan,
  historical cursor, schedule, environment and normal app-token authorization.
- Install compatible permanently signed APK1.0.18/code22 over the existing app.
  Protocol2 is required for new quotes/reserves, so older APKs cannot start
  spending once the flag is enabled. Status/cancel/refund remain compatible.
- Enable onlyPIVNIK_POS_REDEMPTION_ENABLED=true after automated readiness gates.
  Never enable POS globally, replace keys, alter URL masks or touch Selectel/VK.
- Record deployment/CI/signature/read-back evidence below. A physical fiscal
  acceptance remains mandatory before claiming terminal operation is verified.

## Physical acceptance

Use a normal client with sufficient points. In a100₽ receipt, reserve10points,
press the lower Оплата, then pay90₽ by cash. The native receipt must show the
10₽ discount and90₽ payable. The reservation must not debit twice. After cloud
sync the row must be committed, and cashback must use90₽ (4points at5%). Repeat
with bank card; never create a fictitious payment/product for points.

Before paying another receipt, cancel the selected spending and verify the same
10points return exactly once. Delete an unpaid reserved receipt: only a genuine
empty exact-UUID receipt provider AND empty fiscal provider can confirm deletion.
Provider error/null/remaining rows keep it pending; opening bonuses retries.
Completed/deleted fences and terminal operation tombstones survive restart.

Reserve then restart before SDK effect; if the cashier pays full price, explicit
zero cloud discount, no distributed discount, valid absent marker and supported
payments totaling the original sum release the hold. Unknown/wrong evidence
stays in review. Restart after applying the discount must retain it; duplicate
cloud delivery and PAYBACK restore only the proper capped amount once. A new
receipt must have no prior client/beer selection/spending.

Typical visibility delay is cloud ingestion schedule5minutes plus the existing
120-second bonus worker; this is not permission to re-submit a different spend.

## Rollback

Set onlyPIVNIK_POS_REDEMPTION_ENABLED=false. Retain POS, cloud/bonus worker, store
binding and active device key. Existing statuses, cancellations, cloud commits
and refunds must remain available. Do not expire offline holds on a timer or
manually adjust real wallets to make a test pass.

## Evidence

Automated release and actual terminal acceptance are tracked separately. No
physical transaction has been performed by the agent during implementation.

## Candidate validation (2026-10-21)

- PR #297, redemption candidate `16be997ba9410b9bc11e278caf35dfaa5710b36c`.
- Full prepared Node suite: 655 passed, no failures/skips; materialize twice is byte-idempotent, syntax/runtime audits and VK startup parity passed. Root full/production dependency audits report zero vulnerabilities.
- PostgreSQL 17: all 8 real concurrency scenarios passed locally and in Actions.
- Android integration workflow 39528364972: release JVM tests and unsigned APK build passed. Exact final artifact identity is recorded at signing time; this does not establish hardware acceptance.
- The unrelated full release gate found the existing Business Vite 7.3.6 advisory. Vite is patched to 7.3.7, with no other dependency changes, so release checks can pass.
- Manual migration 025 is deployed through the existing sync maintenance job while spending remains off; observe its readiness log, then remove the bounded DDL block. No balances are modified by this migration.

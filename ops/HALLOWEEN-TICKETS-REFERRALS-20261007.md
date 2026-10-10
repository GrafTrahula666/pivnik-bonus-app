# Halloween tickets and invite flow

Base: a813f56a379fa4bf60f34722d44e0f7b7ed5a7b7 (current origin/main after PRs #224-228).
Read ops/MODULE-MAP.md before changes. No draft referral v2 code imported.

## Observations and changes

The production Telegram deployment 22ce975f-2339-4f23-9107-a49308f1c3a6 logged at 2026-10-07T16:22:47.994732517Z:
"Halloween tables are missing: apply migrations/011_halloween_raffle.sql. Tickets and invites are not recorded until then."
This is read-only deployment-log evidence. The owner's specific 1001 RUB transaction and the current schema were not queried; a later operator migration cannot be ruled out.

Previously summary hid missing setup behind tickets=0 and a derived code absent from the resolver table. Summary now returns available=false, tickets=null, no code or links, including when the draw row is absent. Loading and transport failure display a dash with explicit status and retry. Sharing/claim controls are disabled until server data is available.

Manual staff purchase/replay previously awaited achievement sync before the ticket hook. The ticket hook now runs directly after financial COMMIT; a rejected achievement sync is contained so it cannot drop tickets or the successful financial response.

The Halloween page has a visible "Пригласить друга / Ввести код" button. The input remains visible with a reason when ineligible. It accepts a code or a supported Telegram/VK invite URL; the same server checks still enforce the first 24 hours, before any purchase, one inviter, self/cycle/re-created-account guards and the weekly cap. Pending and rewarded counts come from the stored invite rows. Duplicate client submissions are blocked. Counters reload when entering the page, returning from the background and every 30 seconds while visible.

## Wiring and boundaries

server.js owns /api/halloween/summary, /api/halloween/invite/claim and /api/staff/transactions. universal-server.js has no independent versions of those routes; its existing API proxy forwards them. Gateway auth/start_param still uses the shared unchanged claim handler. No auth, roles or platform boundaries changed. Cache query strings updated for app.js/styles.css.

Main already includes PR #224: missing-schema logging, partial-return ticket accounting and scripts/halloween-backfill-purchases.mjs. Those changes are inherited, not rewritten. No schema migration or startup allowlist changed here. No production DB writes, real messages, merge or deploy.

## Validation

Before edits, materialized current main: 514 tests passed.
Targeted tests passed locally: 28 invite/SQL tests (3 new), 3 actual client-function state tests and 2 full manual purchase-handler tests with real persistence/ticket SQL on disposable PGlite.
1001 RUB gives one numbered ticket for accrue/redeem, even with achievement sync failure; replay creates no second transaction/ticket; cancellation reverses tickets. Referral link attribution, pending/rewarded counts, bonus and cancellation tested with actual SQL.
Two full materializations produced byte-identical contents across 471 tracked files.

Final full suite/check/parity/audit were launched; the local executor stopped responding before their logs could be collected. Headless browser checks were also launched but no result or screenshots were verified. Final GitHub CI must pass before review/merge. PGlite and mocked identity/provider boundaries do not prove concurrent PostgreSQL or signed-in production UI.

## Production repair requiring separate authorization

The root setup remains manual migration 011. It must not be made automatic to hide the missing setup.
Review the existing main script, obtain a backup, confirm target database and the current readiness.
Without --apply, the existing command only reports. For approved repair from the owner's test date:
node scripts/halloween-backfill-purchases.mjs --since 2026-10-06T00:00:00+03:00
The existing --migrate --apply flags install 011 and replay purchases through the idempotent hook. Run only after explicit production DB authorization and review the reported transaction IDs. Review partial returns before backfilling: the existing script derives tickets from original check amounts and only scans checks >=1000 RUB. Do not treat a successful backfill message as proof of every invite reward or returned sale.

Separate existing gaps discovered, not expanded into this PR: wheel art/rules mention tickets, but current wheel.js has no pumpkin-ticket prize; the one-off backfill does not recover pending inviter rewards from a sole first purchase below 1000 RUB. Track these separately.

## Review completed on 2026-10-08

Fetched origin; current main is 42ef7d46a3ed13f8b53a60563ea41814436cd894.
Started the review branch at that exact SHA and merged the existing #229 head
03b7f7d34657cff83b985f95c09e269a47eb0a14 into it. The only conflict was the
append position in styles.css: keep both #233 achievement styles and the ticket
control styles. The resulting runtime diff against main is exactly the existing
#229 change; the original PR head gains exactly #233's four-file achievement diff.
No force push or new ticket/referral rules are involved.

- Clean materialized main: 514/514 tests pass; candidate: 522/522, zero skipped.
- Both pass npm run check, verify:vk-startup-parity, VK bundle build with the CI
  fixture PIVNIK_VK_API_BASE=https://vk-gateway.invalid, full npm audit (zero
  vulnerabilities), production audit and npm pack --dry-run.
- Two materializations are byte-identical across 474 tracked candidate files.
  Generated runtime changes were restored before publishing canonical sources.
- Chromium 140 / Playwright 1.55.0: eight Telegram/VK cases at 360x780, 390x844,
  430x932 and 1024x768. Real current HTML/CSS, actual Halloween client functions,
  switchScreen/openModal and original event bindings; fixture API responses.
  Ticket=1, visible referral button with >=44px touch height, pasted invitation
  URL, successful attribution message, expired account explanation, unavailable
  setup, network error and click-to-retry recovery all pass without page errors.
  Input/button rows stay inside the viewport. Screenshots were inspected.
- Existing static VK browser smoke also passes on the materialized bundle.

The browser proof uses extracted current functions and fixture responses, not a
signed-in production account or full provider/SQL integration. The manual
migration/backfill boundary above remains. The historical check was not queried
or repaired. No production database writes, real sends, merge into main or deploy.

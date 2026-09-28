# Module map and "do not break" list

Written 2026-09-28 after a live audit of the running code (not from memory/docs).
Purpose: ground any future "cut by layers" work in what is actually here, so a
refactor doesn't quietly drop an edge case that only exists as inline logic.

## The honest starting picture

This is **not** a single ball of mud. ~20 small, single-purpose modules already
exist (`achievements.js`, `wheel.js`, `qr-resolver.js`, `platform-core.js`,
`authorization-*.js`, `*-transaction-persistence.js`, `broadcast-campaign-store.js`,
`admin-user-directory.js`, `dashboard-summary-repository.js`, …). Business logic
and persistence are already reasonably separated. **The actual monolith is the
route wiring**: two huge files that register and inline-handle HTTP routes.

| File | Lines | Role |
|---|---|---|
| `server.js` | 3392 | Express app. 59 routes. Runs as an internal-only child process (`PIVNIK_CHILD_SERVER=1`, listens on `127.0.0.1:<internalPort>` only). |
| `universal-server.js` | 3432 | Raw `http.createServer` public gateway on `0.0.0.0:<publicPort>`. Spawns `server.js` as a child, proxies most traffic to it, but **re-implements 35 of its own paths directly**, some of which are the *only* implementation the public internet ever reaches. |
| `app.js` | 3599 | Entire client SPA: all screens, all API calls, all rendering. Single file, no bundler. |
| `index.html` | 1004 | Shell markup + a large amount of inline `<script>`/CSS the client relies on. |

Total across these four: ~11,430 lines. This is the real size of the "cut by
layers" job — bigger than the patch-chain, and the part with the most user-facing
risk if split carelessly.

## The two-server split is the sharpest edge

`universal-server.js` does not proxy everything. It **directly implements**
(never forwarding to `server.js`) 12 paths, split into two genuinely different
situations — conflating them was the one inaccuracy an earlier pass of this
document had:

**A) Truly duplicated — `server.js` defines the exact same path independently**,
with its own copy of the handler logic (verified by path, not assumed):
`/api/auth` (`server.js:1580`), `/api/me` GET (`server.js:1674`),
`/api/me/consent` (`server.js:1721`), `/api/me/beta-tester/claim`
(`server.js:1738`), `/api/leaderboard/monthly` (`server.js:1893`),
`/api/staff/activate` (`server.js:2066`), `/api/staff/qr/resolve`
(`server.js:2108`), `/api/admin/users` (`server.js:2911`).

These are **not dead code** — they're what runs when a test imports `server.js`
directly, or if `server.js` is ever run standalone — but in the real deployed
gateway path, the `universal-server.js` copy wins and `server.js`'s copy for
these specific paths is never reached by real traffic.

**Consequence for any refactor:** if you change auth, staff-activation or
similar behavior, you must change it in `universal-server.js`, and you
should check whether `server.js`'s same-named route needs the identical change
for test/standalone parity — they are two independent implementations today,
not one shared handler.

**B) Gateway-only — `server.js` has no route for this path at all**:
`/api/bootstrap`, `/api/wheel/status`, `/api/wheel/spin`,
`/api/account-link/*`. There is nothing to keep in parity here, but it means
searching only `server.js` for these will find nothing, which is its own trap.
The wheel is the sharpest case: it calls into `wheel.js` for the prize
table/draw, then does its own transaction/wallet SQL inline
(`spinTelegramWheel`, `universal-server.js:1858`) — there is no
`server.js`-side wheel logic to fall back to or compare against.

## Route inventory (everything else — `server.js`, proxied as-is)

By rough domain, all still living as inline Express handlers in `server.js`:

- **auth/me**: `/api/auth`, `/api/me`, `/api/me/account` (delete), `/api/me/profile`,
  `/api/me/consent`, `/api/me/qr`, `/api/me/transactions`, `/api/me/beta-tester/claim`,
  `/api/me/messaging-config`, `/api/me/marketing-consent`, `/api/me/achievements/:code/ack`
- **wallet/bonus**: `/api/wallet/config`, `/api/wallet/apple`, `/api/wallet/google`
- **shop**: `/api/shop/catalog`, `/api/shop/contact`, `/api/shop/inquiries`,
  `/api/staff/shop/purchase`, admin shop-items CRUD
- **staff**: `/api/staff/session`, `/api/staff/activate`, `/api/staff/qr/resolve`,
  `/api/staff/transactions` (+ `:id`, `:id/cancel`), `/api/staff/beer-gift`,
  `/api/staff/recent`, `/api/shift/current`
- **admin**: `/api/admin/shift`, `/api/admin/summary`, `/api/admin/broadcast(/preview)`,
  `/api/admin/users` (+ `:id/role`, `:id/pin`, `:id/reissue-qr`, `:id/adjust`,
  `:id/cancel-limit/reset`), `/api/admin/transactions` (+ `:id/cancel`),
  `/api/admin/inquiries` (+ `:id`), `/api/admin/content`, `/api/admin/promotions`
  (CRUD), `/api/admin/design/*`
- **achievements/leaderboard**: `/api/achievements`, `/api/leaderboard/monthly`

(`/api/account-link/*`, `/api/bootstrap` and the wheel are gateway-only — see
"Gateway-only" above, they are not in this file.)

## The prestart/materialize patch chain

`npm start`'s `prestart` runs 13 `scripts/apply-*.mjs` in a fixed order before
`node universal-server.js`; `npm run materialize` runs the equivalent subset
without the Telegram/DB-specific steps. **This is a real, previously-documented
risk** (`docs/vk-startup-forensic-20260913.md` already flagged it: "the archive
overwrite is proven architectural risk"), not a new finding.

Ran the existing conservative audit tool as of this writing
(`npm run audit:runtime-retirement`, canonical phase):

```
Conservative retirement candidates: 0
Startup side-effect review required: 1 (scripts/repair-telegram-runtime.mjs — external network call)
```

**All 13 scripts are still classified as required** (`materialized-release-step`
or `keep-database-step`) by the tool's own conservative criteria. This means
the easy part of "kill the patch chain" is already done (there's history of
`retirement-materialize-once.yml` / `retirement-materialize-v22-preflight-once.yml`
workflows that already retired earlier patches into canonical source) — what's
**left active now is the harder remainder**, not low-hanging fruit. Retiring
any one of these means: read exactly what it changes, move that change into
the canonical source file it patches, delete the apply-script, run the audit
tool again to confirm it now reports the retirement as safe, and keep
`npm run check` + full `node --test` + materialize-idempotency green throughout.

Scripts, in prestart order, and what each one touches (from
`scripts/audit-runtime-patch-chain.mjs` static-target detection):

1. `repair-telegram-runtime.mjs` — Telegram bot menu API call; no file writes.
2. `apply-v22-runtime.mjs` — `achievements.js`, `app.js`, `index.html`, `server.js`,
   `universal-server.js`; triggers steps 2b/2c below.
3. `apply-v22-production-polish.mjs` — gateway profile metadata.
4. `apply-red-cosmos-v2-shell-final.mjs` — `app.js`, `index.html`.
5. `apply-red-cosmos-v2-backend-final.mjs` — `server.js`, `universal-server.js`.
6. `apply-red-cosmos-v2-client-final.mjs` — `app.js`.
7. `apply-red-cosmos-v2-tester-claims.mjs` — `universal-server.js` (`authenticateVk`, token anchors).
8. `apply-release-candidate-fixes.mjs` — `app.js`, `index.html`, `red-cosmos-v2.css`, `universal-server.js`.
9. `apply-working-updates.mjs` — the biggest one: `app.js`, `index.html`,
   `platform-core.js`, `red-cosmos-v2.css`/`.js`, `universal-server.js`,
   `vk-platform.js`, plus two DB/audit scripts. Ships as a gzip+base64 blob
   (`scripts/working-updates-runtime-*.txt`) decompressed at apply time.
10. `apply-vk-production-hotfix-20260831.mjs` — `app.js`, `red-cosmos-v2.css`, `vk-platform.js`.
11. `red-cosmos-v2-db-prepare.mjs` — DB backup + frame-ownership reconciliation (guarded by `DATABASE_URL`/production checks).
12. `apply-icecream69a-frame.mjs` — `app.js`, `server.js`, `styles.css`, `universal-server.js`.
13. `apply-frame-shop-polish.mjs` — `red-cosmos-v2.css`, `server.js`, `universal-server.js`.

Step 9 (`apply-working-updates.mjs`) is the one this session already had to
extend twice (once for the admin-XSS fix, once historically for the
`scheduleFallback` safety fix) — every time canonical source changes something
this script's blob also touches, the script's marker-matching breaks loudly
(`throw new Error(...)`), which is exactly the safety net working as intended,
but it is also the clearest sign this script is the most expensive one to keep
alive long-term.

## "Do not break" — invariants the test suite already enforces

These are not aspirational; each is a real assertion already running in CI.
Treat this as the regression contract for any refactor:

- **Materialize is idempotent.** `release-gate.yml` runs `materialize` twice and
  diffs the tree; a refactor that breaks this fails CI directly.
- **Migration 007 is never rewritten; new data goes in migration 008+.**
  (`test/source-invariants.test.js`, guarded by `apply-working-updates.mjs`
  itself at runtime too.)
- **`qr_aliases` self-aliases (revoked codes) never resolve a client; merge
  aliases still do.** (`test/qr-resolver.integration.test.js`, added 2026-09-27.)
- **Telegram/VK profile names are HTML-escaped in the admin data panels.**
  (`test/audit-hardening-20260927.test.js`, added 2026-09-27 after a stored-XSS fix.)
- **`sendTelegramMessage` has a hard timeout** so a stalled Telegram API can't
  hold a pooled DB client forever. (Same test file.)
- **Broadcast sends are deduplicated** by `(channel, audience, message-hash)`
  fingerprint with a 10-minute advisory-lock window; a repeat send inside that
  window returns the already-completed result or a 409, never a second send.
  (`test/broadcast-campaign-store.test.js`.)
- **Platform separation**: Telegram and VK identities/sessions/roles stay
  distinct in the shared DB (`test/merge.integration.test.js`, `authorization-*`
  test files, `platform-core.js` role-resolution logic).
- **Wheel prize odds and the 1-in-1,000,000 jackpot gate are computed
  server-side** via `crypto.randomInt`, never trusted from the client
  (`wheel.js`, covered by `test/wheel-client-retry.test.js` and others).
- **Staff cancellation quota / unlimited-bonus / suspicious-transaction alert
  thresholds** are enforced in `server.js`'s staff-transaction handlers, not
  the client.
- **VK client bundle never leaks a Railway or Vercel browser origin**, and
  never bundles the Telegram WebApp script
  (`test/vk-native-hosting-main-parity.test.js`, `scripts/build-vk-hosting.mjs`).

Full current baseline: **433/433** `node --test` passing after `npm run
materialize`, `npm run check` clean, `npm audit --omit=dev --audit-level=high`
clean, VK parity 10/10, VK bundle builds clean. This is the regression bar for
every step below.

## My assessment of the proposed plan

Agree with the core call: **do not rewrite.** The database schema, role model,
platform-separation logic and the achievements/wheel/QR edge cases already
have real tests protecting them; a rewrite would have to rediscover all of
that from scratch with no equivalent safety net for months.

Two adjustments to the plan as written:

1. **"Убрать patch-chain" is not one step, it's ~13 separate, sequenced PRs**,
   each gated by the audit tool going from "still required" to "safe to
   retire" for that one script. Scheduling it as a single line item will make
   it look stalled; it should be tracked script-by-script.
2. **The layer cut should target the route files, not the already-extracted
   modules.** "Вынести shop" in practice means: create `routes/shop.js` (or
   similar) that `server.js` mounts, moving the shop-related `app.*(...)`
   registrations and their inline handler bodies out, while the actual shop
   logic stays in `shop-purchase-persistence.js` as-is. Same for staff, admin,
   auth, wheel — the last one specifically has to be *added* to `server.js`
   consistently or explicitly documented as gateway-only, not just moved.

## Proposed first two PRs (in order)

1. **This document** (done) — no code change, establishes the shared map.
2. **Proof-of-concept retirement of exactly one patch script.** Candidate:
   `apply-icecream69a-frame.mjs` or `apply-frame-shop-polish.mjs` — both have
   small, well-isolated targets (frame ownership / shop shelf polish) and
   don't touch auth or money-moving code paths. Goal: prove the
   read-diff-move-delete-reverify workflow end to end once, so the remaining
   ~11 scripts are a known, repeatable process rather than an open-ended risk.

Everything past that (route-file extraction by domain) should wait until the
patch-chain retirement process is proven, since both change the same two huge
files and doing them interleaved would make each harder to review in
isolation.

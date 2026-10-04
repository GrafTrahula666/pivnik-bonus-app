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

`npm start`'s `prestart` runs `scripts/apply-*.mjs` in a fixed order before
`node universal-server.js`; `npm run materialize` runs the equivalent subset
without the Telegram/DB-specific steps. **This is a real, previously-documented
risk** (`docs/vk-startup-forensic-20260913.md` already flagged it: "the archive
overwrite is proven architectural risk"), not a new finding.

**2026-09-28: retired `apply-icecream69a-frame.mjs`** as the proof-of-concept
for this process (see git history / PR for the exact commit). Its diff — a
small, self-contained per-username avatar frame, touching only `app.js`,
`server.js`, `styles.css`, `universal-server.js` and never auth or money — was
copied into canonical source, the script deleted, and it was removed from
`prestart`, `materialize`, `check` and the `APPROVED_PRESTART_COMMANDS`
allowlist in `scripts/audit-runtime-patch-chain.mjs` in the same change.
The process: run the script against a scratch copy to get its exact diff,
copy the already-verified patched files into canonical source (not retype
them — the script's own internal assertions already proved the diff
correct), remove it from all four places that reference it by name, then
re-run the full regression bar below — **plus** diff the fully materialized
runtime files before/after against the pre-retirement baseline, since a
retired script's canonical-source diff can silently change how a *different*,
still-active script behaves (see "Hidden dependencies" below; both
retirements so far have hit this).

**2026-09-28: retired `apply-frame-shop-polish.mjs`** the same way, surfacing
two hidden dependencies fixed in the same change (see below).

**2026-09-28: retired `apply-v22-production-polish.mjs`** the same way. **10
scripts remain.** Its whole diff was two SQL fragments in
`universal-server.js`'s auth/account-link paths (`COALESCE` guards so a
partial re-auth payload can't null out an existing `photo_url`,
`provider_username` or `profile_url`) plus its own idempotency-marker
comment, which was dropped rather than folded in since nothing else reads it
now that the script and its self-referential tests are gone. No new hidden
inter-script dependency was found in the runtime files themselves — this
script's two anchors were unique to it, and the fully materialized
`universal-server.js` before/after this retirement is byte-identical except
for the now-dead `// PIVNIK_V22_PRODUCTION_POLISH_20260827` marker comment
disappearing (nothing else ever read it); the fully materialized `server.js`
has no diff at all. What *did* need cleanup: two pre-existing test
files (`test/v22-production-polish-retirement.test.js`, and one test block
inside `test/v22-production-polish.test.js`) asserted on the *script's own*
before/after execution rather than on canonical-file outcomes; both
necessarily went away with the script file they read, per the same
"delete what the deleted script's own tests exercise, leave outcome-only
tests alone" rule already applied to `test/frame-shop-polish.test.js`
surviving the previous retirement untouched.

**2026-09-28: retired `apply-red-cosmos-v2-shell-final.mjs`** the same way.
**9 scripts remain.** This script only ever wrote `index.html` (it read and
asserted against `app.js` but never wrote to it); on `origin/main` at
retirement time its diff was already a near no-op — the canonical
`styles.css`/`app.js` cache-busting query strings and the "strip legacy
visual layer" regexes were all already satisfied — so folding it in meant
adding exactly two `<link>`/`<script>` tags right after the canonical
`styles.css`/`app.js` tags (`/service-white-gold.css`, `/red-cosmos-v2.js`)
and dropping its own idempotency marker comment
(`<!-- RED_COSMOS_V2_FINAL_SHELL -->`), which like the v22-production-polish
marker before it, nothing else reads. One real hidden dependency was found
and fixed: `apply-v22-product-rebuild.mjs` (invoked by the still-active
`apply-v22-runtime.mjs`, which runs *before* where shell-final used to sit)
temporarily wires `/v22.css` and `/v22-ui.js` into `index.html` as part of
its own migration — its own `verify()` even asserted they were present —
on the assumption that shell-final would immediately strip them again a few
steps later in the same `materialize`/`prestart` run, the way it always had.
With shell-final gone, nothing did, so the first post-retirement
materialized `index.html` still had these two legacy tags wired — a real,
observable runtime regression the byte-diff below caught immediately.
Fixed by moving that exact strip (the same two regexes shell-final used)
into `apply-v22-product-rebuild.mjs` itself, right after it wires the tags,
and flipping its own `verify()` check from "these must be present" to
"these must be absent" — restoring the original final behavior without
touching anything else in that script. No other active patch script touches
this part of `index.html` (`apply-release-candidate-fixes.mjs` only edits
regex literals embedded in `universal-server.js`'s own source, not
`index.html` directly; `apply-working-updates.mjs` edits an unrelated
theme-color meta tag and two unrelated HTML fragments further down the
file). What *did* need cleanup on top of that: **ten** test files read the
script file directly to assert its own internal constants/regexes
(`CANONICAL_STYLE_VERSION`, `forbiddenVisualAssets`, `SERVICE_STYLE_HREF`,
etc.) rather than the canonical `index.html` outcome those constants
produce; each was rewritten to assert the same fact against `index.html`
(and `app.js` for the `SPACEVERSE_CANONICAL_THEME_LOCK` check) directly, and
one redundant script-only assertion in `test/v22-production-polish.test.js`
(prestart still containing this script's name) was removed outright.

**2026-09-28: retired `apply-red-cosmos-v2-client-final.mjs`.** **8 scripts
remain.** Client-only (`app.js` alone; never touches the DB, auth/session or
server money-paths), but a large diff, and the retirement with the most
subtle hidden-dependency trap so far.

**The trap:** running the script standalone against raw canonical `app.js`
gives the *wrong* diff. Its wheel-guard and `APP_VERSION` edits are real
no-ops (canonical `app.js` never had `IS_VK` wheel guards and the committed
`APP_VERSION` already read `'20.0-spaceverse-purple-home'`), but its frame
patch is not: the script's frame-class insertion branches on whether a
`middle-finger` line already exists in `app.js` at the moment it runs. That
line does not exist in *committed* canonical `app.js` — it only exists
*transiently*, added a few steps earlier in the same `prestart`/`materialize`
run by `apply-v22-product-rebuild.mjs` (invoked internally by the
still-active `apply-v22-runtime.mjs`, step 2, well before where client-final
used to sit at step 4). Run the script against committed source directly
and it takes the *other* branch, inserting four new lines after `vladislav`
that never actually fire in real production. The only way to get the real
diff is to reproduce the real chain order: run `apply-v22-runtime.mjs`
first, snapshot `app.js`, *then* run client-final and diff from there. Doing
that gives the true, much smaller diff: `selectedShopItem` set to a real
frame code, **one** new `avatarFrameClass()` line (`premium-smiling-fuck`,
inserted right after the `middle-finger` line that `apply-v22-product-rebuild.mjs`
itself creates), **one** new emoji-map entry (same idea, in that script's
`v22Orbits` map), both QR helper texts swapped, the achievement summary
copy changed, `APP_VERSION` flipped from the intermediate
`'22.0-pivnik-rebuild'` to the final `'20.0-spaceverse-purple-home'`, and —
the biggest piece — the whole `shopActionLabel`/`renderShopCatalog` block
replaced with the contents of `scripts/fragments/red-cosmos-shop-client.fragment.txt`
(adds `RED_COSMOS_SHOP_FRAMES`, `shopFrameOwned`, `shopFramePreviewMarkup`
and `buyShopItem`, replacing the old category-grouped/`data-shop-inquiry`
shop renderer with the direct-buy `data-shop-buy` one).

**The two real hidden dependencies, both in `apply-v22-product-rebuild.mjs`
(the sub-step `apply-v22-runtime.mjs` invokes, running well before where
client-final used to sit):** it creates the `middle-finger` frame-class line
and `v22Orbits` emoji entry that client-final's `premium-smiling-fuck`
insertion depended on, and it unconditionally sets `APP_VERSION` to the
intermediate `'22.0-pivnik-rebuild'` — client-final was the only thing that
ever flipped it back to the final value, in a later, separate script
invocation within the same `materialize` run. With client-final retired,
first materialize after this change left `app.js` with `APP_VERSION` stuck
at `'22.0-pivnik-rebuild'` and the `premium-smiling-fuck` frame-class/emoji
entries silently absent — both real, observable regressions the
before/after byte-diff caught immediately, not something visible in a
standalone script run. Fixed minimally: `premium-smiling-fuck` was added to
`apply-v22-product-rebuild.mjs`'s own `middle-finger`
frame-class/`v22Orbits` insertions (right next to where it already creates
those anchors), and `apply-v22-runtime.mjs` gained one small block, run
*after* its own existing verification already passed, that flips
`APP_VERSION` from the intermediate value to the final one before finishing
that step — mirroring exactly what client-final used to do, just one script
earlier in the chain. Neither script's own existing checks were touched.
One line in the original script (adding a `'premium-smiling-fuck': '🖕'`
emoji-map entry keyed off a **top-level** `'middle-finger': '🖕'` anchor,
a *different* map than `v22Orbits`) is a genuinely separate,
**pre-existing, already-silent no-op in current production** — that
specific anchor string does not exist anywhere in materialized `app.js`
either, so that particular guarded `replace` never fires; left untouched
and documented here, not fixed, since it predates this retirement.

No other hidden inter-script dependency was found beyond the two above:
no other active script touches `shopActionLabel`/`renderShopCatalog`/
`RED_COSMOS_SHOP_FRAMES`/the QR texts (`apply-release-candidate-fixes.mjs`
only adds a click handler that *calls* `renderShopCatalog()`, never edits
its body; `apply-working-updates.mjs`'s only overlapping area is the
unrelated profile frame-*picker*, not the shop). The fully materialized
`app.js` before/after this retirement is byte-identical except for the now-
dead `// RED_COSMOS_V2_FINAL_CLIENT_RUNTIME` marker comment disappearing
(nothing else reads it, consistent with the others). `index.html`,
`server.js`, `universal-server.js` and `red-cosmos-v2.css` are all
untouched by this retirement, confirmed by the same worktree diff.
`scripts/fragments/red-cosmos-shop-client.fragment.txt` is **not** deleted
in this change — per scope, it's flagged here as a cleanup candidate for a
future PR, since after this retirement no active script reads it anymore
(only two test files read its raw content for assertions, which still work
with the file left in place).

**2026-09-28: retired `apply-vk-production-hotfix-20260831.mjs`.** **7
scripts remain.** Touches `app.js` (VK photo-button actionability and an
on-demand VK photo refresh flow on the avatar-source picker) and appends a
CSS block to `red-cosmos-v2.css` (`PIVNIK_VK_COSMOS_BACKGROUND_20260831`,
the VK background/transparent-inner-canvas fix); only *reads* and asserts
against `vk-platform.js`, never writes it (those hooks already live in
canonical source). Both diffs were clean, unambiguous single-target
anchors — unlike the client-final retirement, nothing here depends on
another active script's transient state, so a standalone script run gave
the true diff directly.

**The hidden dependency this retirement was chosen to prove out:** this
script ran *after* `apply-working-updates.mjs` in the old chain (position 7
of 7 remaining, one before `red-cosmos-v2-db-prepare.mjs`), and
`apply-working-updates.mjs` restores `red-cosmos-v2.css` from its
gzip+base64 blob by **wholesale overwrite** whenever the file doesn't
already match the blob's snapshot exactly — the same mechanism that broke
`apply-frame-shop-polish.mjs`'s CSS during its own retirement (PR #162).
Once the `PIVNIK_VK_COSMOS_BACKGROUND_20260831` block was folded into
canonical `red-cosmos-v2.css`, the *next* `materialize` would have hit
`existing !== targetContent` inside `apply-working-updates.mjs`'s restore
loop and silently wiped the VK background CSS back to the blob's older
snapshot. Fixed the same way as PR #162: decoded the blob, appended the
exact same CSS fragment (extracted from the retired script's own
`vkBackgroundFix` template literal) to its `red-cosmos-v2.css` entry,
re-gzipped, re-base64'd, and re-split into the same 3-file,
16000-char-chunk convention (`scripts/working-updates-runtime-*.txt`);
round-trip decode verified before committing. The blob's
`red-cosmos-v2.css` entry now carries both this fix and the frame-shop-polish
one from PR #162.

**A separate, genuinely pre-existing bug, left untouched and documented
here rather than fixed:** the folded-in `app.js` code calls
`applyVkProfileHydration(hydration)` on a successful on-demand VK photo
refresh — but no function of that name exists anywhere in the codebase
(`app.js`, `vk-platform.js`, or anywhere else). This is not something this
retirement introduced; it is exactly what the script has been shipping to
production already. Because the call sits inside a `try`, the resulting
`ReferenceError` is caught by the surrounding `catch` and surfaces as a
generic "не удалось загрузить фото VK" toast — a real, silent regression in
that one on-demand-refresh code path (the hydrated photo data returned by
`refresh()` never actually reaches `state`), but pre-existing and out of
scope for this PR per the "don't use a found bug as an excuse to fix it"
instruction. No other active script references `applyVkProfileHydration`,
the VK photo button logic, or the `PIVNIK_VK_COSMOS_BACKGROUND_20260831`
CSS block, so there is no second hidden dependency to trace here.

Ran the existing conservative audit tool as of this writing
(`npm run audit:runtime-retirement`, canonical phase):

```
Conservative retirement candidates: 0
Startup side-effect review required: 1 (scripts/repair-telegram-runtime.mjs — external network call)
```

**The remaining 7 scripts are still classified as required**
(`materialized-release-step` or `keep-database-step`) by the tool's own
conservative criteria. This means the easy part of "kill the patch chain" is
already done (there's history of `retirement-materialize-once.yml` /
`retirement-materialize-v22-preflight-once.yml` workflows that already retired
earlier patches into canonical source, and now this one) — what's **left
active is the harder remainder**, not low-hanging fruit. Retiring any one of
these means: read exactly what it changes, move that change into the
canonical source file it patches, delete the apply-script, remove it from
`package.json` (`prestart`/`materialize`/`check`) and from
`APPROVED_PRESTART_COMMANDS` in `scripts/audit-runtime-patch-chain.mjs`, run
the audit tool again to confirm it now reports the retirement as safe, and
keep `npm run check` + full `node --test` + materialize-idempotency green
throughout.

Scripts, in prestart order, and what each one touches (from
`scripts/audit-runtime-patch-chain.mjs` static-target detection):

1. `repair-telegram-runtime.mjs` — Telegram bot menu API call; no file writes.
2. `apply-v22-runtime.mjs` — `achievements.js`, `app.js`, `index.html`, `server.js`,
   `universal-server.js`; triggers steps 2b/2c below.
3. `apply-red-cosmos-v2-backend-final.mjs` — `server.js`, `universal-server.js`.
4. `apply-release-candidate-fixes.mjs` — `app.js`, `index.html`, `red-cosmos-v2.css`, `universal-server.js`.
5. `apply-working-updates.mjs` — the biggest one: `app.js`, `index.html`,
   `platform-core.js`, `red-cosmos-v2.css`/`.js`, `universal-server.js`,
   `vk-platform.js`, plus two DB/audit scripts. Ships as a gzip+base64 blob
   (`scripts/working-updates-runtime-*.txt`) decompressed at apply time.
6. `red-cosmos-v2-db-prepare.mjs` — DB backup + frame-ownership reconciliation (guarded by `DATABASE_URL`/production checks).

~~`apply-icecream69a-frame.mjs`~~ — retired 2026-09-28, folded into `app.js`,
`server.js`, `styles.css`, `universal-server.js` directly.

~~`apply-frame-shop-polish.mjs`~~ — retired 2026-09-28, folded into `server.js`,
`universal-server.js`, `red-cosmos-v2.css` directly.

~~`apply-v22-production-polish.mjs`~~ — retired 2026-09-28, folded into
`universal-server.js` directly.

~~`apply-red-cosmos-v2-shell-final.mjs`~~ — retired 2026-09-28, folded into
`index.html` directly.

~~`apply-red-cosmos-v2-client-final.mjs`~~ — retired 2026-09-28, folded into
`app.js` directly (`scripts/fragments/red-cosmos-shop-client.fragment.txt`
kept, no longer read by any active script — cleanup candidate, not deleted
in this change).

~~`apply-vk-production-hotfix-20260831.mjs`~~ — retired 2026-09-28, folded
into `app.js` and `red-cosmos-v2.css` directly; the
`working-updates-runtime-*.txt` blob was regenerated so its
`red-cosmos-v2.css` snapshot carries the VK background CSS too (see below).
**7 scripts remain.**

~~`apply-red-cosmos-v2-tester-claims.mjs`~~ — retired 2026-10-04, folded into
`universal-server.js` directly (`claimPendingSpecialAchievement` helper before
`authenticateVk`, and its call right after the session token is created). The
script's anchors exist in committed source, so a standalone run gave the true
diff. Verified by materializing before and after in two clean copies: the
resulting `universal-server.js` is byte-identical except the dead
`// RED_COSMOS_V2_PENDING_TESTER_CLAIMS` marker, which nothing reads. No other
file differs. Removed from `prestart`, `materialize`, `check` and the
`APPROVED_PRESTART_COMMANDS` allowlist. **6 scripts remain.**

### Hidden dependencies this second retirement surfaced

Retiring one patch script can make an *unrelated, still-active* script behave
differently, because several of them do bare-substring "is this already
applied?" checks against the whole file rather than checking their own exact
target text. Two were found and fixed this time, both in
`apply-red-cosmos-v2-backend-final.mjs` (step 5 — runs long before where
`apply-frame-shop-polish.mjs` used to sit at step 12):

- Its `addPremiumFrameSupport()` guarded on the bare substring
  `"'premium-smiling-fuck'"` to decide whether its own patch (adding
  `premium-smiling-fuck` to an allowed-frame array and a `frames.push()`
  branch) had already run. Once `apply-frame-shop-polish.mjs`'s
  `OWNER_FRAME_CATALOG` — which legitimately lists every frame code,
  including this one — became permanent canonical source in
  `universal-server.js`, that bare check read "already applied" and silently
  skipped this script's real, unrelated patch for the gateway. Fixed by
  checking for its own exact target string instead, **for the gateway path
  only**.
- **The `server.js` path was deliberately left on the old, bare check.**
  Tracing the *original*, unretired chain step by step proved this script's
  `server.js` patch was **already a no-op in current production**, for an
  unrelated reason: its `"'money', 'fire', ...'middle-finger'"` anchor simply
  does not match `server.js`'s actual array text, so `String.replace()`
  silently returns the input unchanged (no exception — `replace()` never
  throws on a non-match) — and the old bare check then still read "applied"
  for an unrelated reason (a different, adjacent `replace()` in the same
  function *does* match `server.js`, adding a `frames.push()` line whose text
  happens to satisfy the same bare substring test). That bug is real, but
  it predates this retirement and this retirement does not touch it —
  fixing it here would have been exactly the "use it as an excuse for
  extra scope" this process is supposed to avoid. It's flagged here as a
  known, separate, pre-existing defect for whoever picks it up next.
- `apply-working-updates.mjs` (step 9) restores `red-cosmos-v2.css` from a
  compressed, versioned blob (`scripts/working-updates-runtime-*.txt`) by
  **wholesale overwrite**, not an anchor-based patch. Its blob predated
  `apply-frame-shop-polish.mjs`'s shelf-animation CSS, so once that CSS was
  folded into canonical source, this step's overwrite silently deleted it
  again on every `materialize`. Fixed by regenerating the blob itself (same
  gzip+base64 format, same 3-file split) to include the shelf-animation CSS
  permanently, rather than changing this script's overwrite mechanism.

None of these three fixes change any script's target behavior versus current
production — each was verified by diffing the fully materialized
`server.js`, `universal-server.js` and `red-cosmos-v2.css` before and after
this retirement (byte-identical for the first two; same CSS rules, just
inserted earlier in the file, for the third).

Step 9 (`apply-working-updates.mjs`) is the one this session already had to
extend twice (once for the admin-XSS fix, once historically for the
`scheduleFallback` safety fix) — every time canonical source changes something
this script's blob also touches, the script's marker-matching breaks loudly
(`throw new Error(...)`), which is exactly the safety net working as intended,
but it is also the clearest sign this script is the most expensive one to keep
alive long-term.

## Old RED COSMOS theme: where it still lived (audited 2026-10-01)

The canonical client palette is white / milk / cream / gold (SPACEVERSE).
What actually ships after `npm run materialize` / `prestart`:

- Linked CSS, in order: `styles.css` → `/loader-fix.css` (inserted by
  `renderAppIndex()` in `universal-server.js`) → `/service-white-gold.css`.
  The same order goes into the VK Hosting bundle (`build-vk-hosting.mjs`
  reuses `index.html`). The final `:root` palette in `styles.css` is already
  white-gold without any JS.
- **Not linked anywhere** (served by the gateway or present on disk only):
  `red-cosmos-v2.css`, `v22.css`. (`black-frosted-*.css`, the root and
  `assets/loader-*` images and `assets/backgrounds/pivnik-{loader,sign,boot-person}`
  were deleted on 2026-10-01: nothing referenced them.) `v22.css` is wired
  into `index.html` by `apply-v22-product-rebuild.mjs` and stripped again in
  the same run.
- **The one live burgundy source was the archived `red-cosmos-v2.js` in the
  `working-updates-runtime-*.txt` blob.** Canonical `red-cosmos-v2.js` has no
  theme code, but `apply-working-updates.mjs` replaces it wholesale with the
  blob copy at materialize, and that copy carried `applyPlatformChrome()`,
  which set the Telegram header/background/bottom bar to `#260718` /
  `#0d0002` / `#120006`. Telegram showed a burgundy bar and background during
  load, and kept it whenever no published design record reached
  `applyDesign()`. VK stubs those Telegram calls, which is why only Telegram
  showed it.
  Fixed the same way as PRs #162/#163: the function and its call were removed
  from the blob's `red-cosmos-v2.js` entry (decode → edit → gzip → base64 →
  the same 3-file 16000-char split). The canonical file still carries the
  `EXPECTED_PRIMARY` anchor that the restore loop requires.
- `app.js` now sets the cream Telegram chrome from `renderCoreProfile()`
  through `applyTelegramChrome()`, so it no longer depends on a design record.
  Dark chrome (`#0b0e13` / `#0e0c0a`) is left in place on purpose while the
  black boot screen is up. The header stays `#0b0e13`, locked by
  `test/service-entry-canonical.test.js`.
- Left on purpose: `red-cosmos-v2.css`, which is unlinked, still rewritten
  from the blob and read by tests; removing it means editing the patch chain.
  `verifyTheme()` in the blob `red-cosmos-v2.js` has no visual effect: it logs
  a failing `console.assert` for `--primary-red` and adds an unused
  `red-cosmos-v2` html class. The semantic danger/error reds and the
  fire/Anna/Olesya avatar-frame art are product colours, not theme.
- VK Hosting is a separate static deploy (manual
  `vk-native-hosting-production.yml`, no runs recorded in Actions; last DEV
  deploy 2026-09-18, from before white-gold landed on 2026-09-22/23). If
  `vk.ru/app54694987` is served from VK Hosting, it shows whatever bundle was
  last uploaded until someone redeploys it.

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

## Progress

1. **This document** (done) — no code change, establishes the shared map.
2. **Proof-of-concept retirement of `apply-icecream69a-frame.mjs`** (done,
   2026-09-28) — proved the read-diff-move-delete-reverify workflow end to
   end.
3. **Retirement of `apply-frame-shop-polish.mjs`** (done, 2026-09-28) — same
   process, this time surfacing and fixing two real hidden inter-script
   dependencies rather than zero (see above).
4. **Retirement of `apply-v22-production-polish.mjs`** (done, 2026-09-28) —
   same process; touched only `universal-server.js`'s auth/account-link
   `COALESCE` guards, no new hidden inter-script dependency in the runtime
   files, but two pre-existing tests bound to the script's own execution
   had to go with it (see above).
5. **Retirement of `apply-red-cosmos-v2-shell-final.mjs`** (done, 2026-09-28)
   — same process; touched only `index.html` (two `<link>`/`<script>`
   tags). Surfaced one real hidden inter-script dependency: a still-active
   sub-step (`apply-v22-product-rebuild.mjs`) temporarily wired `/v22.css`
   and `/v22-ui.js` expecting shell-final to strip them a few steps later,
   the way it always had; fixed by moving that exact strip into the
   dependent script itself (see above). Also, ten pre-existing tests that
   read the script file directly to check its own constants had to be
   rewritten against the canonical `index.html` outcome instead.
6. **Retirement of `apply-red-cosmos-v2-client-final.mjs`** (done,
   2026-09-28) — same process, client-only (`app.js` alone), but the
   trickiest hidden-dependency case so far: a standalone script run gives
   the wrong diff because the script's own frame-patch branches on state
   `apply-v22-product-rebuild.mjs` creates transiently a few steps earlier
   in the same run. Two real hidden dependencies found and fixed there
   (a missing `premium-smiling-fuck` frame-class/emoji entry, and
   `APP_VERSION` left stuck at an intermediate value) without touching
   either script's own verification logic; one separate, genuinely
   pre-existing no-op left untouched and documented (see above).
   `scripts/fragments/red-cosmos-shop-client.fragment.txt` kept in place,
   flagged as a future cleanup candidate now that nothing active reads it.
7. **Retirement of `apply-vk-production-hotfix-20260831.mjs`** (done,
   2026-09-28) — same process; the diff itself was clean and unambiguous
   (`app.js` VK photo-button flow, one CSS block in `red-cosmos-v2.css`),
   but confirmed the exact `apply-working-updates.mjs` blob-overwrite hidden
   dependency this script was chosen to test for: its wholesale-restore of
   `red-cosmos-v2.css` from the gzip+base64 blob would have silently wiped
   the newly-canonical VK background CSS on the very next `materialize`.
   Fixed the same way as PR #162 — regenerated the blob to include the new
   CSS. One separate, genuinely pre-existing bug (`app.js` calls an
   undefined `applyVkProfileHydration` function on VK on-demand photo
   refresh) found, left untouched and documented (see above). **7 scripts
   remain.**
8. **Next candidate**: not chosen yet. Take it only after this one is
   reviewed and merged — one script at a time, per the original instruction,
   not several in a row. Prefer another small, isolated one over
   `apply-working-updates.mjs` (the biggest, blob-based one) until more of
   the smaller scripts are cleared.

Everything past retiring the whole patch chain (route-file extraction by
domain) should wait until the
patch-chain retirement process is proven, since both change the same two huge
files and doing them interleaved would make each harder to review in
isolation.

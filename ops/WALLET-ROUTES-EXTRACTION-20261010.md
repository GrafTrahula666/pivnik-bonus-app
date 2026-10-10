# Wallet route extraction first stage of P3

Three existing Wallet GET routes move from `server.js` into `routes/wallet.js`:
`/api/wallet/config`, `/api/wallet/apple` and `/api/wallet/google`. The registration
stays at its original location with the original authentication middleware and
issuer URLs. This isolates one domain without changing its behavior.

The base is verified `origin/main` at
`95debbd404b4f0834e3fdc4b7498c2ac6a85ed25`. Remote branches and all open PRs were
checked before choosing this domain. Claude's #249 and subsequent small audit
fixes are outside this stage. The user explicitly selected architecture P3;
the still-active patch-chain is preserved, and no general route migration is
attempted in this PR.

## Equivalence evidence

- Removing the module wrapper and two spaces of indentation produces exactly
  the original Wallet route block from main, including middleware, URL parameter
  replacement, availability flags, Russian messages and async behavior.
- Main baseline: materialize twice with identical binary diffs; 527/527 complete
  Node tests, no skipped tests; syntax check, VK startup parity, static VK bundle,
  full and production dependency audit (zero vulnerabilities), dry-run packaging.
- Four added outcome tests execute actual source on loopback. HTTP cases cover
  all four provider availability configurations; Telegram and VK signed sessions;
  401 denials; the gateway's 428 consent refusal; direct/proxied response parity;
  encoded QR values; preservation of existing URL parameters and fragments;
  inability to override the authenticated user with query parameters; POST refusal.
  Only SELECT calls reach the fixture DB adapter.
- Invalid issuer rejection is tested at the handler boundary. Its existing async
  rejection behavior is preserved; no new HTTP error handling is introduced.
- The same HTTP harness was also run against main's original inline route block.
  This establishes before/after behavior against the actual handler source, rather
  than only testing a proposed wrapper in isolation.

## Boundaries and separate finding

The HTTP harness executes checked-out Express auth/mount and gateway
session/consent/proxy code, using real HTTP sockets and signed fixture sessions.
It replaces database reads and profile loading with fixtures. It does not start
the complete production processes, execute network PostgreSQL or verify a real
Apple/Google issuer. Gateway responses still reach the internal Wallet routes.

An invalid configured issuer URL rejects the existing async handler before it
returns JSON. Express 4 does not automatically forward that async rejection to
its error middleware. This pre-existing configuration failure is recorded here
for a separate fix, without changing it during extraction.

Auth/staff/admin/leaderboard implementations, bonus balances, purchases, schemas,
client UI, kiosk, provider settings, dependencies and active patch scripts remain
unchanged. No merge or production deployment is performed.

## Candidate release verification

- Candidate: **531/531 complete Node tests pass**, zero failed or skipped.
  This includes the four new Wallet tests on materialized source.
- Materialize twice: identical SHA-256 hashes across **662 tracked files**.
  The verification copy has its own canonical git HEAD, so tests reading
  `git show HEAD:universal-server.js` observe the correct committed source.
- Checked **658 original tracked files** against the fully materialized main
  baseline. `ops/MODULE-MAP.md` is the sole excluded original documentation file.
  Every other original file is byte-identical after reversing only the Wallet
  import/mount in `server.js` and putting back the original inline handlers.
  The new module's handlers are also identical to that original block after
  removing their wrapper and indentation.
- Canonical/materialized runtime-retirement audits, canonical/materialized VK
  startup parity, `npm run check`, explicit `node --check routes/wallet.js`,
  static VK bundle with `PIVNIK_VK_API_BASE=https://vk-gateway.invalid`, full
  `npm audit`, production audit at high threshold, `npm pack --dry-run`, and
  `git diff --check` pass. Both dependency audits report zero vulnerabilities.
- `package.json` is unchanged to avoid overlapping Claude's #249 check work.
  The new route module is imported by the complete Node test suite, so syntax
  failures in it fail the release gate; its explicit syntax check also passed.

The static VK bundle uses a reserved fixture hostname, not a production API.
No live Wallet pass or production device was exercised. The final changes after
these checks only record the results in this document; runtime code is unchanged.

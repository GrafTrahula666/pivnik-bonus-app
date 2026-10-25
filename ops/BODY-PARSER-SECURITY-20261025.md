# Compressed request parsing security update — 2026-10-25

Owner explicitly authorized fixing the blocking dependency and merging this
separate fix before owner-panel PR #300, subject to the existing merge gates.
Base: verified origin/main 019237ad2cf3d439201d612ebda1282755ad2dfa.

Only the body-parser lockfile entry changes: 1.20.8 → 1.20.9, resolved URL and
registry integrity. Express and all other dependency versions remain identical.
No package manifest, route, auth, money, parser options, SQL, CI, infrastructure,
secrets or production data changes. MODULE-MAP route descriptions remain valid.

Official advisory: https://github.com/advisories/GHSA-27r3-jxmh-p828
Upstream fix: https://github.com/expressjs/body-parser/commit/1260c3845f54502a05a87594f09a334786bb34d7

## Reproduction and regression

An isolated loopback Express process with the existing express.json 1MB limit
and synthetic JSON was exercised against both installed versions. Version
1.20.8 crashed with uncaught Gunzip Z_DATA_ERROR after trailing invalid bytes;
1.20.9 survived the same gzip and deflate cases and answered a subsequent health
request. Identity/gzip/deflate normal JSON, malformed JSON rejection and the
existing 1MB limit also passed. No production URL or financial operation was used.

The new test/body-parser-http-regression.test.js retains those seven behavioral
checks with the real installed Express parser. An uncaught decoder error fails
the Node test process. Its routes exist only inside a loopback test fixture.

## Pre-merge verification

- Exact npm ci succeeds; materialize twice: exit 0, hashes identical across 940
  tracked files. Seven existing generated diffs restored byte-for-byte and excluded.
- Materialized node --test: 656 pass, 0 fail, 0 skipped (includes new regression).
- npm run check and npm run verify:vk-startup-parity: exit 0.
- VK builder: exit 0 using the existing CI fixture https://vk-gateway.invalid.
- npm audit and npm audit --omit=dev --audit-level=high: exit 0, zero vulnerabilities.
- Admin suite is also run by the exact-head release workflow; no native
  PostgreSQL or physical-terminal verification is claimed by this patch.

Use the normal PR merge API with expected head SHA, successful exact-head CI,
current main and any required independent approval. Never bypass protections.

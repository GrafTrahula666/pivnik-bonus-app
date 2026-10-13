# VK Hosting loader CSS parity — Issue #218

Base: freshly fetched origin/main 42ef7d46a3ed13f8b53a60563ea41814436cd894.
HEAD was checked equal to origin/main before creating this isolated branch.
ops/MODULE-MAP.md and supplied project instructions were read. Existing remote
loader branches were inspected: none contains this builder change relative to main.

## Change

The static VK builder now inserts the existing /loader-fix.css?v=2.2.0 directly
after styles.css, matching renderAppIndex's order before service-white-gold.css.
The builder copies the referenced stylesheet and requires its presence, failing
the build if it is missing. CSS contents and the Halloween artwork are unchanged.
Only the builder, a real-build regression test and this report change.

The new test fails on unchanged main because its built CSS list lacks loader-fix.
After the fix it verifies output order, exactly one link, byte-identical copied
CSS, no Telegram SDK and build failure when the source CSS is removed.

## Verification

- Clean main 514/514 tests; candidate 515/515, zero skipped.
- npm run materialize twice: byte-identical across 472 tracked candidate files.
- npm run check, node --test, verify:vk-startup-parity, VK bundle build with
  PIVNIK_VK_API_BASE=https://vk-gateway.invalid, production and full npm audit
  (zero vulnerabilities), npm pack --dry-run and git diff --check pass.
- Chromium 140 / Playwright 1.55.0: actual built HTML and actual gateway
  renderAppIndex('vk'), scripts stripped only for static visual inspection.
  Three viewports, each in normal and Halloween themes; all six candidate
  computed-metric objects equal the gateway objects exactly. The image is
  fully decoded before screenshots; snapshots were visually inspected.

| Viewport | Original scene y | Fixed scene y | Original heading | Fixed heading |
| --- | ---: | ---: | --- | --- |
| 390x844 | 28.484375 | 0 | rgb(23,23,23) | rgb(255,255,255) |
| 430x932 | 29 | 0 | rgb(23,23,23) | rgb(255,255,255) |
| 1024x768 | -126.90625 | 0 | rgb(23,23,23) | rgb(255,255,255) |

Border radius becomes 0px, object-fit is contain, and object-position is 50% 0%,
matching the gateway. The existing landscape letterboxing is preserved.

## Boundaries

No auth/API/routes, DB, kiosk, dependencies, patch-chain or image replacement.
Static Chromium visual proof does not establish live VK/Telegram WebView behavior.
No production operation or merge into main. VK Hosting needs a separate deployment
from the tested merged main; creating this PR does not publish the new bundle.

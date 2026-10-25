# SPACEVERSE owner panel — 2026-10-25

## Scope and provenance

Owner explicitly requested completion and merge of the selected black-hole / blue
owner-panel design with all existing functionality retained. Resumed local branch
`feat/spaceverse-owner-design-20261025` from verified `origin/main@019237ad2cf3d439201d612ebda1282755ad2dfa`.
The previous session had already created the assets, theme, calendar interval and
chart switch but had not committed them. This session reviewed those changes,
restored the accidentally removed admin shop navigation/shortcut, fixed the daily
chart's hourly-only content and dense bar layout, centralized raster paths, added
WebGL initialization fallback/pause and font licenses, and verified the result.

The appearance layer applies to existing CRM, operations, analytics, loyalty,
rewards, promotions, branding, settings, audit and network-management components.
All original API consumers, authorization, tenant boundaries and mutations remain.
A demo KPI expand control retains every original metric. Arbitrary day, existing
presets, custom inclusive range, comparison, product filters and signed amounts
remain available. Missing daily dates are not invented: the graph explicitly
shows dates with cash documents. Range validation mirrors the existing API's
1–366 inclusive calendar days in Europe/Moscow; there is no new historical cutoff.
No backend route, migration, patch script, root runtime or lockfile changes.

## Verification

- `npm run materialize` twice: exit 0, SHA-256 identical across 940 tracked files.
  Seven pre-existing generated differences were backed up and restored byte-for-byte;
  none are part of this change.
- Materialized `node --test --test-reporter=tap`: 655 pass, 0 fail/skip.
- `npm run check`, `npm run verify:vk-startup-parity`: exit 0.
- VK builder: exit 0 with the existing CI fixture `PIVNIK_VK_API_BASE=https://vk-gateway.invalid`.
  First invocation without a configured API base correctly refused to build.
- Admin full Vitest serial run: 436 pass, 20 native-PostgreSQL-only tests skipped.
  Initial parallel CPU-heavy run had 3 existing provisioning 5-second timeouts;
  rerun passed without changing tests/timeouts.
- Admin build/typecheck: exit 0; existing >500KB chunk warning remains.
- Admin lint: 0 errors, 12 existing Fast Refresh warnings.
- Playwright desktop/mobile: 16 pass, 0 fail, including all owner demo sections,
  stationary logo, login/demo/invitations, all 12 KPIs, cash custom dates, signed
  daily/hourly charts, comparison, stale/auth errors, products and CRM scope races.
  First launch failed before execution because Chromium was absent; the official
  Playwright headless shell was installed and the suite then passed.
- Cloud browser: rendered the real frontend with a local synthetic session fixture,
  inspected login, logo, background and demo navigation. This is not production login.

## Historical release blocker and isolated correction

The initial `npm audit --omit=dev --audit-level=high` in the root reported one high
advisory for existing `body-parser@1.20.8`: GHSA-27r3-jxmh-p828, denial of service
via trailing bytes after a compressed body; audit reports fixed in 1.20.9.
The root full audit reports the same high advisory. It is present in the unchanged
main lockfile and was not introduced by this branch. Do not bypass the release gate.
Corrected separately in PR #301 (body-parser 1.20.9 and HTTP regression); its
verified commit is included as a dependency of this branch. Merge #301 first.
Root full and production audits on the combined candidate are clean.

Admin production audit: 0 vulnerabilities. Admin full audit: 2 existing moderate
Vitest development advisories; the unrelated open PR #299 already proposes Vitest
4.1.12. Neither that PR nor #296 was imported or merged here.

## Limits

No production data, account, environment, infrastructure, deployment, real till,
fiscal receipt, kiosk, billing or external message changed. Native PostgreSQL tests,
real tenant login and live financial flows were not executed. Exact-head CI and any required GitHub approval remain mandatory before merge.
PR #301 must land first; no protection is bypassed.

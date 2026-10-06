# Evotor integration: exact CI evidence, 2026-10-06

These results supplement the local-only `EVOTOR-VERIFICATION.md`. They apply to
the tested source commits below. Later documentation-only commits do not change
these sources. Neither complete workflow success nor production readiness is
claimed when audit or inherited gates fail.

| Tested source | Check | Result / evidence |
|---|---|---|
| #209, `d8c2e12e9fb4d98863a34fb80194bae087d30b19` | JVM tests + unsigned release compile | PASS, [run 37408819132](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37408819132). No APK/signing key published, no installation. |
| #209, same source | Root materialization, syntax and Node tests | PASS, 461/461, [release gate](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37408819086). Overall workflow FAIL at runtime audit (3 moderate,1 high,1 critical). Deploy/production-secret steps SKIPPED. |
| #209, same source | Existing VK static/auth/restore/visual browser suite | PASS, [run 37408819064](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37408819064). Static bundle without deployment; isolated VK/TG service/visual parity smoke. |
| #210, `008e746f3266a65d505ca476c66b4cd1b67db244` | Business Vitest, TS/API/Vite, lint | PASS, 61 tests / 14 existing PostgreSQL-dependent skips, 0 lint errors / 10 warnings, [run 37408845187](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37408845187). |
| #210, same source | Desktop 1440×1000 / mobile 390×844 | PASS, 2 Playwright browser cases in the same run. Actual ProductionDashboard on localhost with explicit API fixtures: loading, all/client subset, retry, stale failure, denial clears data, venue switch, empty/disconnected, no horizontal overflow. |
| #210, same source | Full dependency audit | FAIL, 7 findings (1 moderate,4 high,2 critical). Build/browser success does not override audit. |
| #210, same source | Inherited pilot root release gate | FAIL, [run 37408845223](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37408845223): 136 pass / 10 fail; root-only npm install followed by Node discovery of pre-existing Business Vitest `.test.ts` files, `Cannot find package 'vitest'`. All 10 failed paths are unchanged by this delta. Dedicated Business workflow installs both packages and passes Vitest. Pilot gate repair is still required before integrating its merge chain; not silently changed here. |

Browser screenshot artifact: [11387932810](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37408845187/artifacts/11387932810).

These browser tests do not prove live signed Business startup, actual database
membership/session cookies, installed Evotor behaviour, Android Keystore on the
terminal or cloud Extras. SQL fixtures use PostgreSQL/WASM; real concurrent
PostgreSQL/advisory locks still require staging. The real scan→closed cloud
receipt→linked app cohort scenario is BLOCKED until anonymized actual documents
establish Extras namespace and UUIDs. Backend currently uses confirmed scoped
administrative links only. The full user Definition of Done is NOT met.

Both #209 and #210 remain drafts. Main, production database and installed cash
register were not modified. No production deploy/merge/device installation took
place. Existing public startup observation in CI is read-only evidence.

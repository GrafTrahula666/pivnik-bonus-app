# VK startup forensic — 13 September 2026

Status: reproducible startup defects fixed in the candidate; production and physical-device acceptance are still separate gates. This report does **not** establish the cause of the user's individual failed launch, nor claim ten successful production boots.

## Production actually observed

| Item | Evidence |
| --- | --- |
| Repository/default branch | `GrafTrahula666/pivnik-bonus-app`, `main` |
| Inspected main SHA | `d207c2923dbfc01a91e4c019614a548f95a4a5c0` |
| Railway project/environment | `content-nature` / `production` |
| Telegram service | `pivnik-bonus-app`; `pivnik-bonus-app-production-df60.up.railway.app` |
| VK service | `pivnik-vk-test`; `pivnik-vk-test-production-3474.up.railway.app` |
| Telegram deployment | `faf517ba-d6ec-431c-9e31-87166a47956d`, SUCCESS, inspected main SHA |
| VK deployment | `50e5d016-27c1-486c-b1f0-d4b4a6de00dd`, SUCCESS, inspected main SHA |
| Railway source/start | Both services track `main`; `npm start` runs 13 prestart commands, then `node universal-server.js` |
| Health configuration | `/api/health`, timeout 100 seconds; source `checkSuites:false` |
| Existing release CI | Run `34664051001`, success for the inspected main SHA |

Railway deployment configuration and startup logs agree about the commit and command. The URL configured in the actual VK container and the exact frontend bytes loaded on the user's phone have **not** been independently observed. PR #97 contains separate native-hosting work and continued changing during this audit; it has not been merged or incorporated into this candidate.

The available VK HTTP log slice on 13 September contains bootstrap 401, auth 401 with an expired-launch message, then auth 200 and profile 200. Those requests lack a shared boot ID and cannot be attributed to the user's incident. They demonstrate that an expired launch is rejected and some auth requests succeed, not which stage failed for this user.

Public observation from GitHub CI at 23:38:46 UTC ([run 34790296020](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/34790296020), [captured evidence](vk-startup-production-observation-20260913.json)) confirmed both deployed SHAs, IPv4 reachability, verified TLS 1.3, no redirects and the absence of AAAA records. The served VK runtime hash exactly matched the local baseline materialized hash. No external startup assets were listed in the VK document.

It also proved a production routing defect: **both `/red-cosmos-v2.js` and `/red-cosmos-v2.css` returned the same HTML document with HTTP 200 and `text/html`**, on both platforms. The child server exposes only app/styles and then falls back to index.html; the gateway had no routes for these two referenced assets. The candidate serves their actual files with explicit JS/CSS MIME types and `no-cache`. The real gateway HTTP regression checks type and body before DB readiness. The network observer now fails incorrect MIME even when status is 200. This establishes missing assets in the live release, but not that they were the sole cause of the user's missing profile. No CSS or design logic was changed.

## Reproduced failures and evidence

The first ten new recovery cases were run against a materialized copy of the inspected main commit: **8 failed, 2 passed**. The same cases pass after the changes.

| Mechanism | Reproduction / implication | Change |
| --- | --- | --- |
| A temporary bootstrap failure destroys a valid VK session | 502, 503, 429, timeout or network error causes `boot()` to erase storage and authenticate again. An old WebView may then have launch parameters older than the server's 24-hour limit. Retry cannot recover the erased session. | Preserve the session unless the server explicitly rejects it with 401. Show the failure and permit a new bootstrap attempt. |
| Failed Bridge launch lookup is cached forever | First `VKWebAppGetLaunchParams` rejection resolves the cached promise to an empty string. The next auth does not ask Bridge again. | Share only an in-flight lookup; clear the cache on settlement. Existing deadlines and URL fallback remain. |
| Multiple boot attempts overlap | Two calls before bootstrap resolves issue two requests and complete twice. | One in-flight boot; retry does not reset state while it is running. |
| Bridge-only identity remains in `unknown` storage | Signed auth succeeds with a Bridge user ID, but storage prefix remains `pivnik_vk_unknown_`. | On successful signed auth, select that user ID's prefix before the app stores its session. Do not attach an optional Bridge profile for a different signed user ID. |
| Archived VK runtime overwrites source | `apply-working-updates.mjs` restores an entire compressed VK file; the next hotfix modifies it again. A source-only fix can be lost on restart. | Materialize the existing VK profile behavior into `vk-platform.js`; remove only those two scripts' VK writes. Keep their other behavior. |

The overwritten file on the inspected release still contained the earlier URL/hash fallback and timeout logic. Therefore the archive overwrite is proven architectural risk, **not proof that it removed a previous fix or caused this particular incident**. Earlier four VK runtime tests all passed because they did not cover session destruction, rejected-promise reuse or boot concurrency.

## Runtime patch inventory

The [JSON inventory](vk-startup-runtime-inventory-20260913.json) and [baseline trace](vk-startup-baseline-trace-20260913.json) cover every `apply-*`, `force-*`, materializer, startup repair/DB script, and both legacy bootstrap files. It includes source SHA-256, exact condition/replacement locations, lifecycle classification, observed first-run file changes, and limits of the idempotency evidence. Static targets are conservative and include reads; the measured delta is the evidence of an actual write.

This is the real prestart order on the inspected commit:

| # | Script (`scripts/`) | Measured first-run file changes / effect | Guard and disposition |
| ---: | --- | --- | --- |
| 1 | `repair-telegram-runtime.mjs` | No source change; Telegram menu API when configured | Token/platform guard. Retained; network side effect not executed locally. |
| 2 | `apply-v22-runtime.mjs` | achievements, app, index, server, gateway; invokes product rebuild and special achievement patchers | Product/special/RED COSMOS markers. Retained. |
| 3 | `apply-v22-production-polish.mjs` | gateway profile metadata | Marker plus exact replacement guards. Retained; existing retirement tests cover its no-op state. |
| 4 | `apply-red-cosmos-v2-shell-final.mjs` | app, index | Shell/theme markers and replacements. Retained. |
| 5 | `apply-red-cosmos-v2-backend-final.mjs` | server, gateway | Final runtime markers and replacement regions. Retained. |
| 6 | `apply-red-cosmos-v2-client-final.mjs` | app | Final client marker. Retained. |
| 7 | `apply-red-cosmos-v2-tester-claims.mjs` | gateway; attaches pending tester claims to auth | Marker, `authenticateVk` and token anchors. Retained. |
| 8 | `apply-release-candidate-fixes.mjs` | app, index, red CSS, gateway | Exact old/new strings plus verification assertions. Retained. |
| 9 | `apply-working-updates.mjs` | app, index, platform core, red CSS/JS, gateway, VK, two DB/audit scripts | Compressed snapshots plus weak per-file anchors. VK snapshot write and retry injection retired; other writes retained. |
| 10 | `apply-vk-production-hotfix-20260831.mjs` | app, red CSS, VK | Exact old/new profile block, CSS marker. VK write retired; profile hook is canonical, read-only assertions retained. |
| 11 | `red-cosmos-v2-db-prepare.mjs` | DB backup, frame ownership and targeted reconciliation | DATABASE_URL/production guard. No production invocation by this audit. Local parity uses its no-DB exit. |
| 12 | `apply-icecream69a-frame.mjs` | app, server, styles, gateway | Named frame marker and function anchor. Retained. |
| 13 | `apply-frame-shop-polish.mjs` | red CSS, server, gateway | Frame rotation/ownership marker. Retained. |

`materialize` first runs `materialize-runtime-patches.mjs`, which made no changes in the inspected prepared base, then the same file patchers without Telegram repair or DB preparation. `apply-v22-product-rebuild.mjs` and `apply-v22-special-achievement.mjs` are conditional children of step 2. `bootstrap.js` / `bootstrap-vlad.js` are legacy materializer inputs, not the production entrypoint.

The remaining patchers are absent from this production prestart/materialize invocation graph on this base. They were inspected, not executed or deleted: `apply-anna-consent-persistence-fix`, `apply-legal-operator-config`, `apply-luxury-space-background`, `apply-owner-unlimited-cancel`, `apply-platform-profile-refresh`, `apply-platform-separation-safety`, `apply-platform-separation`, `apply-production-final-fixes`, `apply-production-hardening`, `apply-public-release-copy`, `apply-readable-typography`, `apply-release-polish`, `apply-typography-cache-version`, `apply-unifier-active-shift-fix`, `apply-v22-inline-backup`, `apply-v22-preflight-fixes`, `apply-vk-consent-boot-fix`, `force-public-release-ui` (all `.mjs`). Manual invocation can still change shared files or fail on changed anchors; universal semantic idempotency is not established. They cannot independently run on restart through the inspected command chain.

Baseline `vk-platform.js` SHA-256:

- Source: `fab61c122e9c471ad36425f205babdf3555a5259ae43571c8f956f0bc2925dd1`.
- After prestart or materialization: `4650917839251791b9a4b046d110ec41a4c4884db74001f1630443ad680ceb49`.

The new parity gate compares complete VK runtime, account wrapper and diagnostics module, plus client storage/startup state, API, auth, boot, finish/retry handlers and gateway startup route handlers, against canonical source. It executes **prestart → prestart → materialize → prestart** with credentials removed. All four comparisons pass. This is startup-region parity, not byte parity for the entire application. Other legacy patchers still transform unrelated application regions; removing them would expand the risk to Telegram and unrelated features.

## Actual auth / fetch / server path

VK document script order is same-origin vendor Bridge, VK platform adapter, account-link adapter, then app. Installation order: native fetch → VK wrapper → account-link wrapper. Request call order: app API/deadline → account-link wrapper → VK wrapper → native fetch. Background VK photo hydration uses captured native fetch and does not block boot. No extra fetch wrapper was added.

`universal-server.js` receives public `/api/auth`, `/api/bootstrap` and `/api/me` itself; those calls do not go through the child server. Other APIs proxy to `server.js` on localhost:3101. The public gateway uses port 8080 on Railway. Documents can be served before account/database initialization; auth returns 503 while not ready. The health gate waits for the gateway and child, but that does not make transient readiness failures a reason to delete a client's valid session.

VK signature and timestamp validation remain server-side. Optional user/photo data cannot substitute for signed parameters. Platform separation, session verification and identity matching are unchanged. Existing auth uses per-identity advisory transaction locks, a 2500 ms lock deadline, 6000 ms statement deadline, and an 8000 ms connection deadline. No production pool exhaustion or DB latency cause has been proven. Migration SQL files are unchanged. A safety defect was found: the loader selected every numbered SQL file even though migration 009 says it is not wired into startup. The new explicit startup allowlist contains only established migrations 001–008. The actual loader test proves that neither 009 nor an unknown future migration is read or executed; parity also covers the loader and policy. Whether an earlier release already applied 009 to production was not established, and no rollback is attempted.

## Diagnostics

Each page creates a random 24-hex-character boot ID; each server request additionally gets its own random request ID. Client and server observations have explicit source labels, timestamp, elapsed milliseconds, platform, status and an enumerated error code. Server stages cover signature validation, DB connection, identity lookup/write, session creation and profile assembly. AsyncLocalStorage isolates concurrent request traces.

Client records contain no tokens, signed parameters, URL, profile, user ID or free-form exception. The receiver drops unrecognized fields/events, limits bodies to 16 KiB, batches to 24 records, and applies global/per-address rate limits. The client caps transmission at 12 batches per page and uses a two-second telemetry deadline. Telemetry failure does not change the auth result. Client observations are untrusted diagnostics, never authorization evidence.

The error screen displays the boot ID. `/api/release-readiness` gains hashes of the three startup assets read after actual prestart, allowing the deployed bytes to be compared with fetched assets. An absent client event is not proof that a stage was never reached: telemetry itself may be blocked or its budget exhausted.

## Verification and limitations

- Full materialized suite: 308/308 passed locally and in clean-install [CI run 34790295940](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/34790295940). The subsequent asset-route change is verified by the gateway HTTP test and rerun CI on the updated PR head.
- Existing URL/query/hash and hanging Bridge fallback tests pass.
- New cases cover Bridge unavailability/rejection/deadline/delayed params, delayed auth, 401 refresh with changed/unchanged params, mismatched optional profile, account namespace selection, stale unknown storage, transient bootstrap failures, cold gateway, retry, concurrent boot, ten sequential simulated returning-session boots, and Telegram storage/returning-session regression.
- A real localhost HTTP listener uses the actual universal-server routing: safe diagnostics returns 202 before DB readiness, auth stays 503, unauthorized profile routes stay 401, malformed diagnostics is 400, oversized diagnostics is 413.
- The full existing suite includes SQL integration, QR, wallet, achievement, shop, authorization, migration and Telegram regressions. **New/existing VK account creation against a real production database is not newly verified by these client VM cases.**
- Local dependencies exactly match 122 package-lock versions. An offline clean install lacked cached package content; GitHub CI performs the clean `npm ci` and dependency audit.
- Direct production HTTP from this workspace/browser was blocked. The added observation workflow makes public GET requests from GitHub's runner and records DNS A/AAAA, IPv4/IPv6 transport, TLS validation, headers, redirects, same-origin asset hashes, external asset origins and readiness. It performs no deploy or account mutation. A runner result does not establish reachability without VPN on a user's mobile carrier, or real HTTP/2/3 behavior in a VK WebView.
- Source/document tests show a self-hosted VK Bridge and same-origin critical JS/API with CSP `connect-src 'self'` and VK frame ancestors. The actual container/native-hosting frontend still needs confirmation.
- No real iOS/Android VK device, close/reopen, restart/redeploy device series, or ten production boots has been observed. VM tests are not browser or device acceptance.

## Release safety and acceptance

The inspected main release workflow automatically synchronized critical secrets. This candidate changes that step to `railway-ensure-production-secrets.mjs --check`: it only compares the existing resolved values/configuration and fails on a mismatch. Fixture tests reject mutations and prove missing/different secrets or demo settings fail. The old provisioning mode remains a separate explicit operator operation; this task does not invoke it.

Release acceptance requires: green candidate CI; current main/PR head recheck; normal deployment of the reviewed commit; production SHA and runtime-hash comparison; signed auth/profile smoke on designated canaries; gateway telemetry review; and a real VK launch. Existing startup DB preparation still runs on a normal deployment, so its known side effects and the migration gates must be accounted for before triggering a release. This audit does not authorize changing secrets, deleting resources, running destructive/gated migrations or bulk user repair.

One phone test after the diagnosed release is deployed: **without VPN, completely close the Mini App and open it once from VK; report whether the profile appeared, and if it failed send the displayed boot code (or a screenshot of the error).** That one code is enough to correlate the available frontend and server stages; do not send signed launch URLs or tokens.

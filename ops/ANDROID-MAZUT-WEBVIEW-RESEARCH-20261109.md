# Android WebView / Mazut: evidence, decisions, and acceptance (2026-11-09)

## Scope and verified baseline

- Production `main` at audit time: `98b2c9176a28a275118a094c918f29aafb37d489` (Telegram/VK).
- User report: Android main screen has no visible Mazut. This report is valid evidence of the symptom, **not** yet a device-specific diagnosis.
- PR #474 is an isolated Draft based on that main SHA. It is **not** installed on real phones or the bar kiosk.
- The sampled Railway HTTP requests for Mazut JS/CSS/media returned 200, including Android-origin requests; an HTTP 200 does not prove WebGL compositing.
- Existing Chromium/Playwright Android-UA tests are fixtures, **not real Android WebViews**. Do not equate a green fixture test with device acceptance.

## Cross-checked external evidence

1. Android-specific Telegram hardware classes are explicitly `LOW`, `AVERAGE`, `HIGH` in the UA. Use this as a *hint*, not a GPU reliability guarantee.
   https://core.telegram.org/bots/webapps
2. MDN WebGL best practices: conserve VRAM, restore context loss, avoid routine `getError`/`readPixels`/synchronous GPU waits, cap canvas backing pixels; WebGL 1 fragment `highp` is optional on older mobile GPUs.
   https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
3. A 2026 Android WebView issue reproduced context loss on Pixel 8 running Android 16 even when the same page worked in Chrome. This is **another application's case**, not proven to explain PIVNIK.
   https://issuetracker.google.com/issues/540886013
   https://groups.google.com/a/chromium.org/g/android-webview-dev/c/y7bfM9ldBTE
4. A September 2026 developer report describes an **invisible WebGL compositor** with successful shader execution, nontransparent `readPixels`, and no context-loss errors, while 2D canvas still displays. This is anecdotal and platform-specific; it shows why pixel tests alone cannot certify visible output.
   https://www.reddit.com/r/Devvit/comments/1w4sb9n/reddit_android_2026350_expanded_webview_no_longer/
5. A Flutter Android WebView issue on some Samsung Xclipse/ANGLE Vulkan devices also describes missing portions of WebGL output with no context-loss events. Not necessarily reproducible for PIVNIK or all Samsung devices.
   https://github.com/flutter/flutter/issues/188164
6. Android WebView separates renderer and host memory; native WebView debugging tools and Chrome inspection help diagnose actual devices. Access to other applications' WebViews is not guaranteed.
   https://developer.android.com/topic/performance/memory/guide/webview-memory
   https://developer.android.com/develop/ui/views/layout/webapps/debugging
7. 2D Canvas guidance recommends offscreen backing buffers, reduced raster resolution, and `requestAnimationFrame` instead of busy timers.
   https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
8. Cloud testing: BrowserStack **App Live**, not BrowserStack website Live, supports in-app WebViews. Firebase Test Lab offers physical/virtual Android and logs. Virtual devices may use software GPU and differ from Samsung/Mali/Adreno hardware.
   https://www.browserstack.com/support/faq/live/features-live/can-i-test-my-product-functionality-on-in-app-webview-with-live
   https://firebase.google.com/docs/test-lab/android/get-started
   https://firebase.google.com/docs/test-lab/android/avds

## Risk ranking and implementation decision

| Risk | Evidence | Conservative action |
| --- | --- | --- |
| Android WebGL shader or FBO fails after context is created | Confirmed unfallbacked path in PIVNIK main; general MDN/Chromium precedent | PR #474: switch to existing CPU Canvas2D with a new backing canvas; no shader edits |
| WebGL context lost after first frame | Confirmed original PIVNIK event only nulled `gfx`; Chromium issue precedent | PR #474: switch to CPU 2D rather than retain transparent canvas |
| CPU fallback itself freezes the Android main thread | Existing CPU raster loops over pixels and particles; no per-device FPS evidence | Android-only software backbuffer 260/300/340 px for LOW/balanced/HIGH, 55ms target interval and adaptive resolution floor. **Neither iPhone nor regular GPU parameters change** |
| Legacy media-query/observer APIs absent | Original PIVNIK event subscription unguarded; MDN compatibility | PR #474: `MediaQueryList.addListener` fallback and observer guards |
| WebGL silently fails to composite despite working GPU/GL metrics | Developer reports; **not proven locally** | No forced global WebGL shutdown. Do not invent a reliable autodetector. Require real in-app WebView screenshots; keep CPU fallback available |
| Fragment `highp` unavailable | MDN WebGL 1 compatibility | Existing shader retained; failed compilation routes to Canvas2D. Do **not** switch shaders wholesale to `mediump` without visual comparisons |
| GPU memory pressure / thermal throttling / large DPR | MDN and Android WebView memory guide | Existing GPU quality cap and RAF/visibility pause retained; no unmeasured rewrite of physics, shader or fluid viscosity |
| Android System WebView provider differs from Chrome | Android documentation and field reports | Test Telegram and VK *inside their apps*, not Chrome alone; distinguish provider/GPU/OS and reduced-motion settings |
| Old asset cache blends client versions | Versioned PIVNIK loader exists | Bump only changed Mazut assets; never clear live sessions/bonuses or mutate cache at runtime |

## Release acceptance, in order

1. Exact-HEAD CI: double `materialize` idempotence, `npm run check`, complete `node --test`, audit, VK bundle/parity, full Telegram/VK fixture navigation/QR/bonus safety.
2. Failure-injection browser smoke: Android LOW shader compile failure + legacy `MediaQueryList`, verify CPU canvas **actually contains painted pixels**. Android HIGH normally uses WebGL. Compare iOS browser path before/after.
3. Extend fixture cases separately for `getContext('webgl') === null`, context-loss event, framebuffer incomplete and both 2D/WebGL unavailable, with screenshot evidence. Beware mock coverage masquerading as device coverage.
4. On real cloud **in-app Android WebView**: at least one Samsung and one Pixel/Adreno or equivalent, older and newer WebView, Telegram and VK, with production-equivalent but isolated test credentials. Verify visible fluid after launch, navigation/back, return from background, tilt/touch, orientation, QR, responsiveness and no overheating or prolonged jank. Compare iPhone current functionality.
5. If actual WebGL content is invisible with *no* WebGL errors, first collect visual/video and environment info. A forced 2D compatibility route can be designed as a separate user-triggered fallback; do not silently replace the renderer for all Android users.
6. Only then review production release gate, rollback and exact deployed SHA. Never deploy a Draft directly to real kiosk. No changes to auth, POS, bonus ledger, wheel odds, shared server routes or Android signing keys as part of this performance issue.

## Explicit non-actions

- No automatic GPU vendor blacklists derived from UA or fingerprinting without device evidence.
- No continuous `readPixels`, `getError`, full-screen screenshots, personal tokens or raw auth payloads in telemetry.
- No changes to iOS WebGL shader, 1.265 viscosity, layouts, sessions, backend or payment flows.
- No claims of a production fix until real Android screenshots and native provider smoke confirm it.

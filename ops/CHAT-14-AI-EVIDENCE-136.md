# SPACEVERSE · CHAT 14 · пункт 136 — проверяемые AI evidence и «Недостаточно данных»

**Статус:** независимый server-only proof-of-contract без AI/API/production включения. **Дата:** 2026-11-01.  
**Base main:** `c92ed7cd65f1a96d94363c2b7e212424ab078a73`. **Ветка:** `spaceverse/chat14-ai-evidence-136-20261101`.

## Фактическая основа

- Прочитаны актуальные `ops/MODULE-MAP.md` / Do not break и код `admin-platform/server/types.ts`, `admin-platform/server/evotor-read.ts`, `ops/SAAS-ANALYTICS-AI-ARCHITECTURE.md`. Существующий `getEvotorReport` возвращает `all:null` при неподключённом POS; lastSuccessAt **не гарантирует полноты исторического периода**. Число фискальных чеков может быть `null`; показатели разных tenants не суммируются.
- Из [CHAT 14 / #132](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/352): планируемый allowlisted metric catalog/snapshot, **пока Draft, не HTTP API**. Из [#133](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/356): независимый default-off AI entitlement, тоже Draft. Из [#134](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/364): static synthetic preview, а не ответ AI. [#135](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/369): docs-only budget policy. Их код не копируется и не считается уже развёрнутым.
- Взят ровно пункт **136**: дать структуру источников и честную `insufficient_data` fallback. Ни реальные источники, ни провайдер модели не подключаются, потому что это разрушило бы условия точной tenant изоляции и оплаты до интеграции основ.

## Что реально добавлено

1. `admin-platform/server/ai-evidence.ts` — чистая server-side функция `buildAiEvidence`, которая принимает **только подготовленные авторизованным сервером** сведения и запрошенные ссылки `snapshotId+metricId` с проверенным canonical `companyId/venueId`. Максимум 8 ссылок за раз. Она не открывает сеть/SQL, не получает admin cookie, токены, историю клиента, произвольный текст модели и ничего не записывает.
2. В доказательстве сохраняются source/metric/snapshot ID, period [from,until), timezone, asOf, unit и **строковое** значение (без loss of precision), но не tenant IDs и PII. Авторизованный факт не «исправляется» в UI или моделью.
3. `status:'ready'` допускается только если **каждый** факт соответствует заданному canonical venue/company, существует ровно одна запись по ссылке, `status:'available'`, `coverage:'complete'`, корректная дата/asOf и валидное числовое decimal-string. `0` принимается как доказанный ноль; `null` не превращается в ноль. Неизвестный coverage, stale, missing, foreign, duplicate, invalid, неполный период => `insufficient_data`, `citedFacts:[]` и фраза «Недостаточно данных для подтверждённого вывода».
4. Даже при `ready` сервис не генерирует свободную AI-причину: в limitations закреплено, что net POS revenue **не прибыль**, а корреляция сама по себе **не доказательство причины**. Поле `mode:'server-evidence-only'` не выдаётся за модель и не маскирует synthetic fixture как реальный факт.
5. `admin-platform/server/tests/ai-evidence.spec.ts`: positive verified zero, signed BigInt-sized cents, cross-company/venue attempt, missing, stale, partial/unknown, duplicate/forged refs, invalid text, ambiguous source. Тестовые факты synthetic, не PIVNIK production.

## Чего НЕТ (обязательно учесть на интеграции)

- Нет AI runtime routes/промптов/LLM, нет записи citation в DB, нет SQL и connection to live POS. `AuthorizedAiMetricFact` — **доверенный server-only input по контракту**, не проверка подлинности произвольного JSON из браузера или LLM. Будущий вызывающий модуль обязан каждый раз: `loadSession` → `resolveVenueScope` → актуальный RBAC/AI entitlement → secure allowlisted metric tool → server-owned snapshot → `buildAiEvidence`. При отзыве доступа/cross-tenant request снова fail closed.
- Эта функция проверяет **структуру и привязку citation**, но не доказывает причинность или истинность произвольного **текста** LLM. Нельзя соединять валидный snapshot с придуманной моделью суммой, даже если citation существует. Следующий пункт 137 обязан проверять prompt injection, quoted model output, попытки tool escalation и cross-tenant access; будущий formatter должен разрешать только значения из инструмента, а не произвольные числа из prose.
- `coverage:'complete'` нельзя выставлять, просто увидев `lastSuccessAt`; пока реального подтверждения полноты POS за историческое окно нет, live-интеграция этого source обязана показать **«Недостаточно данных»**, а не «анализ готов».
- `ready` в unit-тесте означает **успешную проверку синтетического evidence fixture**, не доказательство live business accuracy. Никаких платных вызовов, токенов, трат, ROI или прогноза.
- `status='insufficient_data'` не означает отсутствие продаж: деньги/чеки/покупатели сохраняются как `null/unavailable` и не переписываются. Источники, периоды и ошибки должны объясняться владельцу без утечки внутренних параметров других компаний.

## Приёмка и тесты перед будущей реальной интеграцией

- Signed HTTP с двумя компаниями и двумя точками одной компании, side-channel leaks, role/revoke, server snapshot cache invalidation, scope swap, foreign ID/SQL prompt injection.
- Реальный proof-of-coverage для выбранного интервала, nullable receiptCount, 0 vs null, SELL/PAYBACK, разрешённый кэш, неизменная единица денег.
- Проверка model output schema, citation resolution (все упомянутые числа должны ссылаться на факты), пропуск stale/unknown, HTML/Markdown injection, повторная авторизация при drilldown.
- Browser/mobile: явные loading/stale/error/permission и «Недостаточно данных» без synthetic на production Dashboard. **Сейчас эти E2E не выполнены**.

## Checkpoint

- Пункт **136**; создан pure typed helper и negative unit tests, без изменений маршрутов, `server.js/universal-server.js`, migrations, config, package.json, секретов или production.
- **Main base SHA:** `c92ed7cd65f1a96d94363c2b7e212424ab078a73`; **branch:** `spaceverse/chat14-ai-evidence-136-20261101`; commit/PR/CI перепроверить на точном HEAD после публикации.
- Локальный checkout отсутствует, поэтому `npm run materialize`×2, `node --test`, `npm run check`, `npm audit`/Vitest не запускались локально; результат GitHub CI привести отдельно, когда будет.
- Режим: **Draft PR → координатор CHAT 01 → без merge/deploy/production writes**. Если CI красный, исправить 136, а не переходить к пункту 137.
- Почасовой CHAT14 scheduler ранее не создан из-за лимита 5/5; другие автоматизации не отключать без разрешения.

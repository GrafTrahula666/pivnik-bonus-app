# SPACEVERSE · CHAT 14 · пункт 134 · Synthetic preview

**Задача:** сделать честный, изолированный mock/preview, без внешнего AI API, без выдачи простого if/else за интеллект.  
**База:** main `c92ed7cd65f1a96d94363c2b7e212424ab078a73`. **Ветка:** `spaceverse/chat14-ai-preview-134-20261101`. **Режим:** Draft PR; никакого merge/deploy/production writes.

## Что реально реализовано

- `admin-platform/src/phaseC/ai-synthetic-preview.ts`: **не AI-вывод**, а константный локальный учебный набор. Маркеры `mode='synthetic'`, `provider='none'`, `externalRequests=0`, `usesRealVenueData=false`, `generatedByModel=false`. Содержит ровно три иллюстрации: сравнение тренда, отсутствие достаточных данных для аномалии, гипотеза для проверки. Чисел кассы, клиентских идентификаторов и ссылок на API там нет.
- `admin-platform/src/phaseC/AiSyntheticPreview.tsx` + scoped CSS: русскоязычный статический блок с предупреждением «СИНТЕТИЧЕСКИЕ ДАННЫЕ», пояснением «нет AI-модели» и явным указанием ограничений/источника. Touch/mobile responsive. Нет кнопки генерации, платного submit, бэкенд-источников или декоративного вывода выдуманного ROI.
- `admin-platform/src/phaseC/DemoMode.tsx`: единственная точка монтирования preview, только при `mode==='demo'` и странице `analytics`. Не вмешивается в production `ProductionAnalytics`, `App.tsx`, Auth, реальные POS-отчёты, клиентские данные, server routes, ORM или базы.
- `admin-platform/src/tests/ai-synthetic-preview.spec.ts`: assertions на прозрачную маркировку, deterministic static sample, ноль `fetch` вызовов во время render, отсутствие PII/remote URL в fixture, отсутствие импорта preview в production App.

## Отличие от будущего AI

Это **визуальная концепция и синтетическая фикстура**. Она не объясняет реальную выручку и не производит автоматический анализ. Ничто из этих подсказок не является бизнес-рекомендацией. Нет вызова LLM, поиска, внешнего API, секретов, новой подписки, активации AI или использования действующего venue scope.

Реальный pipeline в будущем: authenticated server session → canonical scope → независимый AI entitlement (#133) → allowlisted aggregate tools (#132) → evidence/coverage/quality checks (#136–139) → approved model/provider (#140). Этот preview намеренно **не подключён** к нему и не выдаётся за его имитацию.

## Регрессия и границы

1. Прочитаны актуальные на запуске `ops/MODULE-MAP.md` / Do not break и origin/main. Ничего из них не изменяли; patch-chain, migrations, `server.js`/`universal-server.js`, деньги, касса, киоск и Railway не затронуты.
2. Соседние Draft PR независимы: [#341 (131)](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/341), [#352 (132)](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/352), [#356 (133)](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/356). По каждому подтверждён успешный GitHub Release Gate на его собственном HEAD; все ждут интеграционного ревью, не смержены.
3. Здесь нет локального checkout репозитория, поэтому локальные `npm run materialize` ×2, `node --test`, `npm run check`, `npm audit`, `npm test --prefix admin-platform`, браузерные E2E не выполнялись. Их состояние проверять по GitHub CI после публикации PR, а не утверждать PASS заранее.
4. Все изменения ограничены существующей страницей **demo analytics**, новым компонентом, fixture, CSS, тестом и данным checkpoint. Production UI/AI backend остаются без новых функций.

## Checkpoint

- **Пункт:** 134. **Состояние:** программный synthetic preview создан, необходимы GitHub read-back/CI/review. Не называть завершённым до полного зелёного CI.
- **Branch:** `spaceverse/chat14-ai-preview-134-20261101`; commit SHA и Draft PR установить после публикации.
- **Секреты/оплата/production:** не менялись. Нет AI API, DB migration, provider keys или activation.
- **Следующая задача:** пункт 135 budgets/quotas/request ledger/kill switch, только после завершения 134, отдельная ветка и PR.
- **Hourly schedule:** ранее создание CHAT 14 было заблокировано лимитом активных автоматизаций 5/5, чужие расписания не отключать.

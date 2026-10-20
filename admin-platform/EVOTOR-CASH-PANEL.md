# Касса Эвотора в PIVNIK Business

«Обзор» заведения открывается на вкладке «Все продажи кассы». Рядом «Клиенты приложения» и
«Операции приложения» (прежний обзор по журналу бонусной программы, подписан как операции
приложения, а не кассовая выручка).

## Откуда данные

`GET /api/admin/venues/:venueId/pos?days=1|7|30|90|365` (`server/evotor-read.ts`):

- заведение проверяется прежним `resolveVenueScope` по сессии Business;
- магазин Эвотора берётся только из явной привязки `pos_store_bindings` (tenant + location, `enabled`);
- чтение идёт через read-only пул в одной транзакции `REPEATABLE READ READ ONLY`;
- суммы считает тот же модуль приложения `pos/analytics.js` (`posDashboards`), второго расчёта денег нет;
- день и период — по Москве.

ВСЕ продажи = клиенты приложения + без связи с PIVNIK. Клиентские чеки уже входят в общий итог,
суммы не складываются. Пока нет таблиц POS, привязки или первой полной сверки, панель показывает
«Касса не подключена» / «Нет данных», а не нули и не суммы бонусной программы.

## Сборка

`server/evotor-read.ts` импортирует `../../pos/*.js`, поэтому Docker-образ собирается из корня
репозитория: Dockerfile `admin-platform/Dockerfile`, контекст — корень, исключения в
`admin-platform/Dockerfile.dockerignore`. В образ копируются `pos/`, `migrations/` (тест кассы строит таблицы POS из миграций приложения), `platform-core.js`, `qr-resolver.js` и корневой `package.json` (для `"type": "module"`).

## Проверки

- `npm test` (Vitest): `server/tests/evotor-read.spec.ts`, `src/tests/cash-*.spec.ts`, `src/tests/sales-loading.spec.ts`.
- `npx playwright test --config playwright.evotor.config.ts`: настоящий компонент «Обзора» на фикстурах
  (1440×1000 и 390×844), без сервера, БД и внешних API. В CI — workflow `business-cash-browser.yml`.

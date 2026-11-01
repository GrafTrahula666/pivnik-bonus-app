# CHAT 03 — CRM / Customer 360 checkpoint

**Дата:** 2026-11-01
**Направление:** только задачи 21–30 из `CHAT_03.md`.
**База ветки:** `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
**Режим:** isolated [Draft PR #359](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/359), без merge/deploy/production writes.

## 21 — Проверено в предыдущем checkpoint

Найден `admin-platform/server/tenant-crm-read.ts`, merged PR #284,
с сохранением `requireLegacyBar` в `admin-platform/server/data.ts`.
Ни legacy PIVNIK guard, ни runtime/модели кошельков не менялись.

## 22 — Уже реализовано в подготовительном контуре, merged PR #285

Список чужой компании под явным `spaceverse_customer_ownership`,
server-side pagination и проверенный target DB binding существуют в
`customer-directory-repository.js` и `TenantCustomerDirectory.tsx`.
Результат **ограничен подготовленной неактивной CRM**:
`runtimeStatus=not_provisioned`; подключение к `ProductionCRM` активной
компании **не подтверждено и зависит от отдельной activation/license работы**.
Не подменять её чтением draft и не ослаблять legacy guard.

## 23 — проверено на изолированном native PostgreSQL (код готов к review, не к production)

В этой ветке изменены:
- `customer-directory-repository.js` и `.d.ts`: whitelist sort id/name/username,
  direction asc/desc, wallet all/present/missing, серверные count/filter/sort
  **до LIMIT/OFFSET**, строгий tie-break по ID. `present` означает
  существующий кошелёк, включая нулевой баланс.
- `tenant-crm-read.ts` и `router.ts`: параметрическая проверка до
  target DB; scope, duplicate parameters, неизвестные поля по-прежнему запрещены.
- `TenantCustomerDirectory.tsx` и `tenant-crm-contract.ts`:
  touch-доступные select, reset page/selection, ignore late responses,
  echo-check по sort/direction/wallet вместе с q/scope/offset.
- `tenant-crm.spec.ts`: browser desktop/mobile-путь проверяет выбор сортировки и фильтра кошелька, сохранение объёма выдачи и сброс состояния. Дополнительно 15 последовательных страниц реального HTTP/SQL fixture с 355 клиентами, достижение последней страницы (5 записей) и отсутствие горизонтальной прокрутки.
- `tenant-crm-http.spec.ts`: добавлены тесты
  350 пользователей с сортировкой до страниц, wallet-state/empty/zero,
  cross-scope denial и invalid filters.
- `ops/MODULE-MAP.md`, tenant CRM runbook: уточнён контракт и release boundary.

**Это НЕ новая активная CRM.** Функция по-прежнему default-off,
не использует чужие данные, не подключает Market/license/POS,
не меняет `GET /api/admin/venues/:id/clients` и его ПИВНИК-only reader.

## Проверки и подтверждённый checkpoint 2026-11-01

- **main SHA:** `c92ed7cd65f1a96d94363c2b7e212424ab078a73` (read-only GitHub).
- **Кодовый head:** `73c7f235c2e913d4ad2c02bbe7343c2fec645d4d` в ветке `spaceverse/chat03-crm-tenant-list-20261101`.
- **Draft PR:** [#359](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/359), без merge/deploy.
- **Специализированный CI:** [tenant CRM browser and HTTP, run 41270788178](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41270788178) **SUCCESS**: native PostgreSQL 16, signed HTTP/SQL **40 passed**, desktop Chromium **4 passed**, mobile Chromium **4 passed**. На обоих размерах пройдены **15 страниц из 355 клиентов** до последних пяти строк. Сценарии проверяют поиск, фильтры, сортировку, cross-tenant denial, сброс карточки и отсутствие горизонтальной прокрутки. Отдельные browser server-процессы сохраняют реальный лимит 30 чтений/мин на актора.
- **Полный release gate:** [run 41270788123](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41270788123) **SUCCESS** на том же кодовом SHA: materialize дважды + idempotence, JS check, root Node **606 passed / 0 failed**, Admin Vitest **646 passed / 90 skipped**, Business audit `--audit-level=high` exit 0, production audit exit 0. Остались **12 moderate** advisories: отдельная задача, не менялись.
- **Смежные CI:** [native PostgreSQL](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41270788022) **SUCCESS**; [Business browser](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41270788025) **SUCCESS**.
- **Railway read-only:** в доступном проекте `pivnik-admin-staging` последний обнаруженный SUCCESS deployment на ветке `admin-platform/staging-qa` (2026-08-31, SHA `cb3e7cbb`), не этот Draft. Живые данные/Market/лицензия/production E2E не проверялись.

Ранее специализированный browser CI выявил реальные проблемы селекторов и
общего тестового лимита запросов. Исправлены только доступные имена фильтров,
селекторы и изоляция synthetic desktop/mobile fixture. Серверный rate limit,
legacy PIVNIK guard, `server.js` и `universal-server.js` не менялись.
Проверка PR diff на кодовом head подтвердила отсутствие правок этих двух
legacy маршрутизаторов. Критические `Do not break` условия остаются под
успешным release gate.

## Передача и продолжение

**Пункт 23: DONE в подготовленном default-off tenant CRM контуре.** Это не
означает активную коммерческую CRM, подключённую кассу или разрешение релиза.
Передать Draft PR #359 координатору CHAT 01 для review/интеграционной очереди.
Не мержить и не деплоить самостоятельно. Следующий отдельный запуск CHAT 03
может брать **пункт 24** только в новой изолированной ветке после проверки
актуального main, PR и границ владения; не подменять его скрытой записью
клиентов в legacy PIVNIK CRM.

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

## 23 — текущая незавершённая задача, первый минимальный срез

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

## Проверки

GitHub API: проверены current main SHA, origin branches, merged PR #284/#285,
`ops/MODULE-MAP.md` Do not break, source files, existing HTTP fixtures,
и compare baseline vs branch.
Локальный checkout отсутствует: container `git ls-remote` не может разрешить github.com.
Новые root materialize×2 / node --test / check / audit,
Admin Vitest/Playwright desktop+mobile **ещё не выполнены**.
**Логи проверены лично для `3ca6c5fc141fe97c93758a9f5bce8e665145aafb` (до нового 15-page E2E теста):** GitHub Actions `Pivnik release gate` SUCCESS: двойная материализация, idempotence, syntax, root Node 606/606 passed, Admin Vitest 646 passed / 90 skipped (40 `tenant-crm-http.spec.ts` passed), audits `--audit-level=high` exit 0. Есть **12 moderate vulnerabilities** в результатах аудита зависимостей, не относятся к изменению сортировки и требуют отдельной задачи, не исправлять попутно. `CRM beer inventory native PostgreSQL` SUCCESS, `Business cash dashboard browser check` SUCCESS (его CRM-прогон охватывает legacy CRM, не tenant-specific новый E2E). На новом commit `4f96a3f8b501ef2ca55fdad5540db636c33281d2` CI запущен, результаты нужно проверить отдельно.
**Новый tenant-specific Playwright e2e на desktop/mobile НЕ запускался в этих GitHub workflows.** Контейнер без GitHub DNS; offline прогон невозможен без исходников/зависимостей.
CI, тесты и typecheck на текущем head обязательно проверить перед review;
не считать скрипты выполненными на основании существования тестов.

## Продолжение

Задача 23 остаётся **IN PROGRESS**, пока не будут выполнены регрессионные
проверки и не будут исправлены их результаты. Следующий запуск продолжает
этот же пункт, а не начинает 24.
После зелёных тестов передать Draft PR координатору CHAT 01,
без самостоятельного merge/deploy.

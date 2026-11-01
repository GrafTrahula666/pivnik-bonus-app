# CHAT 03 — CRM / Customer 360 checkpoint

**Дата:** 2026-11-01
**Направление:** только задачи 21–30 из `CHAT_03.md`.
**База ветки:** `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
**Режим:** isolated Draft PR, без merge/deploy/production writes.

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
CI, тесты и typecheck на текущем head обязательно проверить перед review;
не считать скрипты выполненными на основании существования тестов.

## Продолжение

Задача 23 остаётся **IN PROGRESS**, пока не будут выполнены регрессионные
проверки и не будут исправлены их результаты. Следующий запуск продолжает
этот же пункт, а не начинает 24.
После зелёных тестов передать Draft PR координатору CHAT 01,
без самостоятельного merge/deploy.

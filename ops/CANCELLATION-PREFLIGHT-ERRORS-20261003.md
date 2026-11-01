# Отмена операций: ошибки до транзакции — 2026-10-03

## Состояние и один выбранный этап

`origin/main` после fetch: `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`.
Новая ветка от этого SHA. Status/history/remotes/worktrees проверены;
прошлые рабочие копии и их draft PR не включались. Прочитан
`ops/MODULE-MAP.md`, применимых AGENTS.md не найдено. Открытые PR обновлены
через GitHub; обе проверки #184 завершились успешно (release 37105091795,
VK parity 37105091740). #180–184 остаются отдельными незамерженными PR.

Выбран один связанный сценарий: надёжный отказ при отмене финансовой операции
владельцем или сотрудником. В main `pool.connect()` обоих cancel handlers был
вне try/catch. У staff также вне catch были resolveActingStaff, replay lookup
и получение профиля при replay. Rejected promise этих операций не попадал
в next(error) Express 4. Два новых targeted теста воспроизводят дефект на
исходных маршрутах: pool rejection и staff preflight rejection.

В scope входят только два POST cancel handlers server.js. Получение клиента
и staff preflight помещены в try; rollback/release только при наличии клиента.
Причина/ключ по-прежнему проверяются перед try, auth/role middleware сохранены.
Существующие лимиты, owner unlimited cancellation, replay/conflict, lock order,
финансовый cancel engine, уведомления и success response не менялись.
Переотступы staff preflight объясняют основную часть диффа 35+/29-.

В universal-server.js отдельного cancel handler нет: оба POST проксируются
в Express. Настоящий proxyRequest проверен через loopback HTTP-серверы.
Universal код не менялся. Другая незамерженная cancellation/tenant foundation
не подключалась; исправление корректировки бонусов #184 сюда не переносилось.

Для владельца/сотрудника панель теперь получает серверный ответ об ошибке
при отказе пула или staff preflight, вместо необработанного async-handler
сбоя. Это не новая возможность отмены и не изменение финансовых правил.

## Существующие функции и пробелы

| Функция | Найденная реализация | Проверенность | Пробел | Следующий небольшой шаг |
|---|---|---|---|---|
| Касса / Эвотор | #174, origin feat/evotor-sales-dashboards-20261002 | Реализация найдена, не переписана | Нет реальной кассовой приёмки | Стенд импорта SELL/PAYBACK и сверка |
| Business кассовый обзор | #176, отдельный admin-platform пакет | Ранее 52 Vitest, typecheck/build | Venue-scoped adapter отсутствует | Ревью CI #181 и отдельный adapter |
| CRM / Customer 360 | main directory, #115, tenant origin #96 | Общий regression проходит, draft read/action foundation найдена | Авторизованная рабочая карточка не проверена | Тестовая сессия, поиск/история |
| Корректировки бонусов | main route/persistence, #182–184 | Предыдущие отдельные HTTP/SQL проверки и зелёный CI | Unsafe ввод исправлен пока только в draft; нет concurrent PostgreSQL | Ревью существующих PR и тестовый стенд |
| Отмена операций | main staff/admin cancel handlers | Семь новых сценариев и реальный HTTP proxy в этом PR | Реальный финансовый engine/БД в новых тестах подменены | SQL fixture отмены, баланс и journal rollback |
| Telegram-рассылка | main campaign-store и retry origin ветки | Существующие тесты включены в gate | Реальный provider/UI не проверен | Фиктивный provider preview/retry |
| Достижения / рамки | main achievements/personal frames, Business grants | Существующие tests проходят | Нет owner desktop/mobile выдачи | Тестовая сессия/клиент |
| Права / аудит | main authorization/journal; #96 и Business tenant/audit | Новые tests выполняют настоящие auth/role middleware с fixture sessions | Legacy single-bar не доказывает tenant isolation | Продолжать scoped draft, проверять чужие ID |

## Проверки и сохранение

- Чистая npm ci по main lockfile; зависимостей/env/сервисов не добавлено.
- Новые тесты исполняют фактические route и auth/role middleware из server.js.
  Session signature, identity mapping, pool, cancel engine, profile/quota и
  Telegram provider заменены детерминированными фикстурами. Real-data writes нет.
- Семь сценариев: pool rejection owner/staff; staff PIN/replay/profile failure;
  BEGIN/cancel failure с rollback/release; 401/403/invalid; success/replay и
  изменённые transaction/reason conflict; staff quota denial и owner unlimited;
  HTTP 500 обеих ролей через фактическую gateway proxy функцию.
- Replay fixture моделирует уже записанную отмену. Проверка не доказывает
  реальную SQL идемпотентность cancel engine, которая требует отдельного этапа.
- Полная materialize дважды: SHA-256 всех tracked файлов после первого/второго
  прохода совпадают; изменения cancel handlers сохраняются.
- node --test: **443/443**, 0 fail/skip. npm run check и VK startup parity PASS.
- После восстановления canonical runtime семь новых тестов также PASS.
- npm audit: прежние **3 moderate**, 0 high/critical; исправление отдельно #180.
- Публичный read-only probe VK/TG: **16/16**, release 18a0fa4, ready/DB OK.
- Generated materialize изменения восстановлены; в server.js оставлены только
  два cancel handlers. Ни patch scripts, ни UI, ни DB migrations не менялись.

Не проверены owner desktop/mobile, production sessions, реальная касса/
Telegram, многосессионные PostgreSQL locks, реальный cancel engine на SQL,
сетевые ошибки/неопределённый COMMIT. Существующий post-COMMIT profile/message
error path сохранён и нуждается в отдельном исследовании, не расширялся
попутно. Локальных PostgreSQL/Docker для concurrency стенда нет.
Не было merge/deploy, production-БД/данных или массовой рассылки.

Следующий небольшой этап: изолированный SQL-тест отмены и повторной отмены
с проверкой баланса и rollback журнала, без подключения к production.

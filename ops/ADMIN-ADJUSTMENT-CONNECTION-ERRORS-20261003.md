# Корректировка бонусов: отказ подключения к БД — 2026-10-03

Актуальный `origin/main`: `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`.
Ветка создана от него после fetch. Проверены status/history/remotes/worktrees,
прочитан `ops/MODULE-MAP.md`, применимых `AGENTS.md` не найдено. Предыдущие
рабочие копии сохранены отдельно. Список открытых PR обновлён: #180–183,
#174/#176, Customer 360 #115 и tenant foundation #96 не смержены.
Release gate #183 завершён успешно (run 37101574073).

## Выбор одного этапа

Для следующей многосессионной проверки PostgreSQL не найдены локальные
postgres/initdb/psql/Docker. PGlite не подтверждает межсоединительные блокировки.
Новый сервис ради этой проверки не добавлялся.

Вместо непроверяемого утверждения выбран подтверждённый дефект существующего
маршрута `/api/admin/users/:id/adjust`: `await pool.connect()` был вне try/catch.
Отказ пула отвергал promise async-handler без вызова Express `next(error)`.
На исходном main первый новый тест воспроизвёл ошибку (1 fail, 2 pass).
В Express 4 этот путь не попадает в существующий error middleware маршрута.

Теперь получение клиента включено в тот же try; rollback/release выполняются
только при полученном клиенте. Кодовая правка: 6 insertions / 3 deletions
в одном обработчике server.js. Пуловая ошибка передаётся в существующий
error middleware и возвращает HTTP 500 JSON. Ошибка PostgreSQL с кодом 53300
не раскрывает fixture DB message клиенту. Нормализация, права, request key,
locks, сумма, журнал и response success/replay не менялись.

Universal gateway не имеет отдельного обработчика этой корректировки:
POST проксируется в Express. Его код не менялся; настоящий proxyRequest
проверен локальным HTTP-сценарием и сохраняет HTTP 500 и JSON.
Существующая tenant draft route-handler уже перехватывает ошибку делегированного
executor, но эта архитектура не подключена к main; она не переносилась.
Незамерженная валидация суммы #182 также не включена в этот PR.

Для владельца устраняется путь зависшего/необработанного запроса при отказе
пула БД: вместо ложной неопределённости панель получает серверный ответ об
ошибке. Это не обещание доступности при полной недоступности инфраструктуры.

## Инвентаризация функций

| Функция | Реализация | Проверенность | Пробел | Следующий шаг |
|---|---|---|---|---|
| Касса / Эвотор | draft #174 | Код импорта и двух обзоров найден | Реальная кассовая приёмка отсутствует | Стенд SELL/PAYBACK и сверка документов |
| Business кассовый обзор | draft #176 | Ранее 52 Vitest, typecheck/build | Venue-scoped adapter отсутствует | Ревью CI #181, отдельный адаптер |
| CRM | main admin-user-directory.js | Общий regression gate проходит | Авторизованный UI не проверен | Поиск/пагинация в тестовой сессии |
| Customer 360 | #115 и tenant origin draft | Read/action foundation найден | Не всё включено в main | Ревью существующей реализации |
| Telegram-рассылка | main broadcast-campaign-store.js и retry-ветки | Существующие tests проходят | Provider/UI end-to-end не проверен | Фиктивный provider preview/retry |
| Корректировки | main route/persistence, #182/#183 | В этом этапе connection/BEGIN errors + HTTP gateway; SQL-проверки #183 на изменённом маршруте | Concurrent PostgreSQL пока недоступен | Отдельный стенд нескольких соединений |
| Достижения / рамки | main achievements и personal frames, Business grants | Существующие tests проходят | Авторизованная выдача desktop/mobile не проверена | Тестовый клиент и сессия |
| Права / аудит | main authorization/journal; #96 и Business tenant/audit | SQL fixture 401/403 + actor/reason; scoped foundation найден | Single-bar main не доказывает SaaS tenant isolation | Продолжать существующие scoped сценарии |

## Проверки

- Чистая `npm ci` по main lockfile; зависимости не изменены.
- Четыре новых теста: pool rejection → next один раз без success; BEGIN
  failure → исходная ошибка, rollback attempt и release; invalid input
  до connect; настоящий Express error middleware + настоящий gateway proxy
  возвращают 500 JSON без утечки DB error message.
- Полная materialize дважды; SHA-256 всех tracked файлов одинаковы после
  первого/второго прохода. Изменение маршрута сохраняется после цепочки.
- `node --test`: **440/440**, 0 fail/skip. `npm run check` и VK startup parity PASS.
- Дополнительные пять SQL/HTTP фикстур #183 выполнены на изменённом маршруте:
  начисление/списание, replay/conflict, ошибка SQL INSERT с rollback/retry,
  401/403/invalid, missing user/overdraft — **5/5**. Для проверки использован
  временный файл, затем удалён; тесты чужого draft в коммит не включены.
- После восстановления canonical runtime четыре новых теста также PASS.
- `npm audit`: прежние **3 moderate**, 0 high/critical. Исправление отдельно #180.
- Read-only public production probe: **16/16**, release 18a0fa4, ready/DB OK.

Сохраняются прежние generated изменения полного materialize. Перед коммитом
они восстановлены; из server.js оставлен только изменённый adjustment handler.
UI не менялся, desktop/mobile не проверены. Реальные session signature,
owner UI, касса/Telegram, межсоединительные PostgreSQL locks, сетевой сбой
или неопределённый COMMIT не проверены. Auth/role middleware не изменены;
новый error HTTP fixture моделирует уже авторизованного пользователя.
Production-БД/данные, миграции, рассылки, merge/deploy не затронуты.

Следующий маленький этап: проверить конкурентный повтор и wallet lock на
отдельном тестовом PostgreSQL, когда стенд доступен. Другие обнаруженные
`pool.connect()` вне try в финансовых маршрутах требуют отдельного аудита,
не изменялись попутно этим PR.

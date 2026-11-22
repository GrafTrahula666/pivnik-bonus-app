# SQL-проверка отмены финансовых операций — 2026-10-03

## Реальное состояние и выбранный этап

Fetch/status/history/remotes/worktrees проверены. Origin main остаётся
`18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`; новая ветка от этого коммита.
Прочитан `ops/MODULE-MAP.md`, применимых AGENTS.md не найдено. Предыдущие
рабочие копии сохранены отдельно. Список открытых PR сверён через GitHub.
#180–185 не смержены; обе проверки #185 зелёные (release 37108400672,
VK parity 37108400673). Незамерженные изменения автоматически не переносились.

В main уже есть cancelCompletedTransaction, wallet/beer/journal updates,
semantic cancellation replay, сотрудник/смена scope и два HTTP cancel handlers.
Есть static regression tests и HTTP/provider fixtures #185, но реальный SQL
движок в них не исполняется. В проверенной tenant origin ветке отдельного
PGlite cancellation integration test не найдено. Выбран один небольшой этап:
проверить этот существующий SQL и rollback на БД в памяти. Новой финансовой
реализации, API или пользовательской возможности не добавлено.

## Инвентаризация функций

| Функция | Найденная реализация | Проверенность | Конкретный пробел | Следующий шаг |
|---|---|---|---|---|
| Касса / Эвотор | draft #174, origin feat/evotor-sales-dashboards-20261002 | Код импорта/двух обзоров найден | Нет реального end-to-end подключения | Стенд SELL/PAYBACK и сверка |
| Business кассовый обзор | draft #176, admin-platform пакет | Ранее 52 Vitest, typecheck/build | Venue-scoped adapter отсутствует | Ревью #181, отдельный adapter |
| CRM | main admin-user-directory.js, pagination origin | Общий regression проходит | Авторизованный UI не проверен | Поиск/пагинация тестовой сессией |
| Customer 360 | #115, tenant draft #96 | Существующий read/action foundation найден | Не весь сценарий включён в main | Ревью существующей карточки/API |
| Корректировки бонусов | main persistence/route, #182–184 | Предыдущие отдельные HTTP/SQL проверки | Concurrent PostgreSQL и UI не проверены | Ревью существующих PR, тестовый стенд |
| Отмена операций | main cancel engine, staff/admin handlers, #185 | В этом этапе шесть настоящих SQL сценариев; в #185 HTTP/role/provider проверки | Post-COMMIT сбой и independent connection races не проверены | Проверить profile/provider error после COMMIT |
| Telegram-рассылка | main campaign-store, retry origin | Существующие tests проходят | Реальная доставка/UI не проверены | Фиктивный provider preview/retry |
| Достижения / рамки | main achievements/personal frames, Business grants | Существующие tests проходят | Owner desktop/mobile выдача не проверена | Тестовая сессия и клиент |
| Права / аудит | main authorization/journal, #96/Business tenant | SQL доказывает staff/shift guard и actor/reason в отмене | Legacy single-bar не доказывает SaaS tenant isolation | Продолжать scoped foundation с foreign-ID tests |

## Изменения и проверенные сценарии

Добавлены только `test/cancellation-sql.integration.test.js` и этот отчёт.
PGlite уже devDependency проекта. Каждая фикстура — отдельная БД в памяти.
Исполняются фактические cancelCompletedTransaction, lockRequestKey,
hasUnlimitedBonus и handler владельца из текущего server.js. Их код не копируется
в новую production-реализацию и не запускает server startup services.

CREATE TABLE users/wallets/beer_loyalty/transactions, 13 релевантных startup
upgrades и UNIQUE index cancel_request_key извлекаются из server.js.
Fixture mode CHECK разрешает только существующие режимы тестового сценария.
SQL/constraints/transactions не подменены. pg-compatible rowCount adapter
нужен из-за различия интерфейсов PGlite и pg.

1. Отмена accrue, redeem, shop, beer_gift восстанавливает соответствующий
   кошелёк/пивной объём. Проверяются конкретные суммы, cancelled journal,
   actor/reason/request key/time, одно уведомление и release клиента.
2. Точный replay не возвращает бонусы второй раз и не отправляет второе
   уведомление. Изменённые actor/reason/transaction ID с тем же ключом дают
   409. Второй ключ для уже отменённой операции даёт 400. Таблицы неизменны.
3. Настоящий SQL CHECK failure при UPDATE transactions после wallet/beer
   updates откатывает обе таблицы и journal. Client освобождён, уведомления
   нет. После удаления fixture constraint тот же ключ успешно выполняется.
4. Израсходованные начисленные бонусы/пивной объём, unsupported adjustment
   mode и отсутствующая операция отклоняются без изменения состояния.
5. Engine staffId/notBefore guards не разрешают отмену чужого сотрудника
   или операции предыдущей смены; после rollback таблицы неизменны.
6. Пустой ключ/короткая причина не запускают транзакцию. Unlimited wallet
   не обновляется, тогда как операция отменяется по существующим правилам.

Для владельца это проверенное свойство существующего сценария: повторная
отмена не удваивает возврат, а отказ записи статуса не оставляет частично
изменённый кошелёк. Новых production-возможностей этот test-only PR не добавляет.

## Проверки и границы

- Чистая npm ci по main lockfile, новых dependencies/services/env нет.
- Полная materialize дважды, одинаковые SHA-256 всех tracked файлов после
  первого/второго прохода. Generated изменения восстановлены перед коммитом.
- node --test: **442/442**, 0 fail/skip; npm run check и VK startup parity PASS.
- Шесть новых SQL тестов отдельно проходят на canonical runtime.
- Полный npm audit: прежние **3 moderate**, 0 high/critical, исправление #180.
- Public read-only VK/TG probe **16/16**; release 18a0fa4, ready/DB OK.
- Routes не менялись. Gateway проксирует оба POST cancel в Express; его
  HTTP parity уже проверен #185, повторная production-модификация не нужна.

Новый fixture исполняет handler после auth/role middleware boundary.
Authentic session signature/owner authentication/UI здесь не проверяются;
401/403 middleware проверены отдельно в #185. Profile serialization,
owner identity detection, transaction response serialization и Telegram send
заменены фикстурами. Не было реальных сообщений. Staff route/quota здесь
не исполняются целиком, проверяются именно финансовые staff/shift engine guards.

PGlite выполняет настоящий PostgreSQL-совместимый SQL, но последовательные
фикстуры не доказывают конкуренцию независимых PostgreSQL-соединений,
сетевой отказ, неопределённый COMMIT, production tenant isolation или работу
с реальной кассой. Локальные PostgreSQL/Docker отсутствуют. Desktop/mobile
UI не проверены и не менялись. Нет production writes/migrations, merge/deploy.

Следующий небольшой этап: воспроизвести путь после подтверждённого COMMIT
при сбое чтения профиля/уведомления и определить корректный подтверждённый
результат в интерфейсе, сохраняя существующую идемпотентность отмены.

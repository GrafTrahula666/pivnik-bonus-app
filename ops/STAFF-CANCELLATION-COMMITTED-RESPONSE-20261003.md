# Подтверждённая отмена сотрудником при сбое ответа — 2026-10-03

## Реальное состояние и выбор

Проверены fetch, worktrees/status/history/remotes, актуальный origin/main,
origin-ветки и открытые PR. Main остаётся 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Ветка создана от него; чужие рабочие копии сохранены. Прочитан ops/MODULE-MAP.md;
применимых AGENTS.md не найдено. Обе исходные инструкции изучены ранее.
Изменения feature/kiosk-shifts d982913 не включены. PR #180–187 остаются
незамерженными; обе проверки #187 зелёные (37115790380, 37115790381).

Выбран подтверждённый баг ближайшего рабочего сценария: staff cancellation
делает COMMIT, затем читает профиль и квоту. Отказ этого чтения раньше выдавал
обычную ошибку и пытался откатить уже сохранённую отмену. При повторе найденная
отмена снова читает профиль/квоту вне transaction catch и также может упасть.
Это мешает сотруднику понять, была ли операция действительно отменена.

| Функция | Найденная реализация | Проверенность | Конкретный пробел | Следующий шаг |
|---|---|---|---|---|
| Касса / Эвотор | draft #174, origin evotor-sales-dashboards | SELL/PAYBACK и два обзора найдены | Нет реальной кассовой сверки | Тестовый источник, возвраты/дубликаты |
| Business кассовый обзор | draft #176 | Ранее 52 Vitest, build/typecheck | Нет venue-scoped adapter | Ревью CI #181 и adapter |
| CRM | main admin-user-directory.js, pagination origin | Общие tests проходят | Signed-in поиск не проверен | Тестовая сессия, поиск/пагинация |
| Customer 360 | draft #115, tenant #96 | Read/action foundation найден | Не весь сценарий включён в main | Ревью существующих API/карточки |
| Корректировки бонусов | main persistence/route, #182–184 | Ранее HTTP/SQL сценарии | Нет concurrent PostgreSQL/UI проверки | Ревью существующих PR |
| Отмена операций | main staff/admin handlers/engine, #185–187 | Здесь восемь новых HTTP/SQL тестов | Staff post-COMMIT сбой скрывал сохранённую отмену | Этот фикс; затем поведение UI |
| Telegram-рассылка | main campaign store и retry origin | Общие tests | Нет проверки реальной доставки/UI | Mock provider preview/retry |
| Достижения / рамки | main achievements/personal frames, Business grants | Общие tests | Owner desktop/mobile выдача не проверена | Тестовый клиент/сессия |
| Права / аудит | main authorization/journal, tenant #96 | Здесь role gate, staff scope и actor/reason отмены | Legacy single-bar не доказывает SaaS isolation | Scoped foreign-ID сценарии |

## Изменено

Только staff cancellation handler в server.js. Общая локальная функция ответа
обслуживает успешно закоммиченную отмену и найденную ранее отмену, для которой
совпали transaction ID, cancelled_by и причина. При сбое чтения профиля/квоты
возвращает HTTP 503, code=cancellation_committed, cancelled=true и сохранённую
transaction, с явным сообщением об уже отменённой операции и необходимости
обновить список. Это подтверждает финансовый результат, не обещает успешную
доставку уведомления или актуальную квоту. После известного COMMIT такой сбой
не отправляется в transaction catch/ROLLBACK.

Успешный 200 contract, проверка PIN/session/роли, advisory quota lock,
active/remaining quota, staffId/notBefore engine scope и уведомление только
для новой отмены сохранены. При BEGIN/engine/COMMIT failure подтверждение не
выдаётся. Изменённый ключевой смысл replay по-прежнему даёт 409. Provider
возвращает ok=false по прежним правилам; неуспешная доставка не стала ложным
подтверждением прочтения или покупки. Новых зависимостей/env/таблиц нет.

Владелец получает более понятный и безопасный процесс отмены сотрудником:
сбой обновления данных не заставляет воспринимать сохранённую отмену как отказ.
UI не менялся. Успешный financial outcome пока представлен специальной ошибкой
503 с пояснением, а не отдельным визуальным состоянием панели.

## Проверено

- До фикса новые profile/replay проверки воспроизвели баг main.
- Шесть handler/HTTP тестов: profile/quota после COMMIT и replay; несовпадение
  ID/причины; ошибки BEGIN/engine/COMMIT; 401/403, invalid reason/key,
  inactive/exhausted quota; успех/повтор и owner unlimited bypass.
- HTTP использует actual authRequired/requireRole с mock session/profile,
  настоящий Express и universal gateway proxy, фактический клиентский api().
  Автоматический retry сохраняет подтверждённый результат: одна mutation,
  одно соединение и одно уведомление при quota error, без ROLLBACK.
- Два SQL теста используют фактический staff handler/cancel engine и startup
  schema в изолированной PGlite. Profile/quota stub failures после COMMIT
  оставляют wallet=75, paid_ml_total=500, gift_ml_balance=500, cancelled journal
  с actor/reason. Повтор не меняет снимок. Реальный CHECK failure откатывает
  wallet/beer/journal; чужая staff операция даёт 403 без подтверждения.
  Schema/API adapters не являются production migration; тесты не запускают
  серверные startup services. PGlite уже присутствует в main devDependencies.
- npm ci; полная materialize дважды, SHA-256 всех tracked файлов совпадают.
- node --test после materialize: 444/444, 0 fail/skip; npm run check PASS.
- VK startup parity PASS. Эти cancel routes gateway проксирует в server.js,
  второго обработчика отмены в universal-server.js нет. Generated diff восстановлен.
- Восемь новых tests проходят также на canonical runtime.
- npm audit: прежние 3 moderate, 0 high/critical, отдельное исправление #180.
- Read-only production probe: 16/16 reachable responses, childReady и прежний
  main release SHA. Production writes и реальные рассылки не выполнялись.

## Границы и дальнейший шаг

Нет доступной signed-in desktop/mobile сессии и отдельного PostgreSQL-стенда.
Независимые соединения/конкуренция, настоящая Telegram-доставка и end-to-end
tenant isolation не проверены. Session/provider/квота в fixtures подменяются;
в SQL fixture считаются отмены и исполняется настоящий quota advisory lock,
но фактический production getCancellationQuota не запускается.

Preflight/acquisition failures остаются отдельным #185; owner response — #187.
Они автоматически не включены сюда; при ревью учесть пересечение staff handler
с #185. Не выполнены merge/deploy или изменения production данных.
Следующий небольшой этап — UI-обработка cancellation_committed: показать
сохранённую отмену, обновить историю и явно отметить недоступную квоту, с
проверкой desktop/mobile на фиктивных данных.

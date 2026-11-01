# Ответ владельцу после сохранённой отмены — 2026-10-03

## Состояние и выбор

Рабочие копии, status/history/remotes, fetch origin/main и origin-ветки,
открытые PR проверены. Main: 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Эта ветка начинается от него. ops/MODULE-MAP.md прочитан; применимых
AGENTS.md не найдено. starter-pack и база знаний изучены ранее и сохранены.
Чужие рабочие копии и незамерженные реализации не включены.
PR #180–186 остаются отдельными. Release CI #186 (37112243141) зелёный.

Подтверждена регрессия: owner cancellation уже делает COMMIT, затем читает
профиль. При отказе этого чтения catch пытается сделать ROLLBACK и возвращает
обычную ошибку, хотя финансовая отмена сохранена. Владелец не понимает результат.
Выбран только этот серверный ответ; staff-сценарий и acquisition errors отдельно.

| Функция | Найденная реализация | Проверенность | Конкретный пробел | Следующий шаг |
|---|---|---|---|---|
| Касса / Эвотор | origin и draft #174 | Импорт SELL/PAYBACK и два обзора найдены | Нет реальной кассовой сверки | Стенд подключения/возвратов |
| Business dashboard | draft #176 | Ранее 52 Vitest, typecheck/build | Нет venue-scoped adapter | Отдельный adapter после ревью |
| CRM | main admin-user-directory.js, pagination origin | Общие tests проходят | Авторизованный поиск/UI не проверен | Тестовая сессия, поиск/пагинация |
| Customer 360 | #115 и tenant #96 | Read/action foundation найден | Не включён весь сценарий в main | Ревью существующей реализации |
| Бонусные корректировки | main, #182–184 | Отдельные HTTP/SQL проверки | UI и concurrent PostgreSQL не проверены | Ревью PR и тестовый стенд |
| Отмена владельцем | main engine/handler, #185–186 | Здесь HTTP retry и SQL post-COMMIT | Сохранённая отмена раньше выглядела неудачной | Этот фикс; затем staff ответ |
| Telegram-рассылка | main campaign store, retry origin | Существующие tests | Нет подтверждения реальной доставки/UI | Mock provider preview/retry |
| Достижения / рамки | main, Business grants origin | Общие tests | Выдача desktop/mobile не проверена | Тестовый клиент и сессия |
| Права / аудит | main authorization/journal; #96 tenant | Ранее SQL actor/reason и staff/shift guards | Legacy main не доказывает SaaS tenant isolation | Foreign-ID tests scoped foundation |

## Изменено

В owner handler server.js результат отмечается сохранённым только после
успешно завершённого COMMIT. Если после этого не удаётся сформировать ответ,
сервер возвращает 503 с code=cancellation_committed, cancelled=true,
сохранённой transaction и сообщением «Операция уже отменена. Не удалось
обновить данные клиента. Обновите список операций». ROLLBACK после подтверждённого
COMMIT не вызывается. Это отказ обновления ответа, а не обещание полной успешной
работы внешнего провайдера. Обычный 200 contract сохранён.

При неуспешном/неопределённом COMMIT подтверждение не выдаётся. Причина и
requestKey проверяются прежним кодом. Provider уже возвращает ok=false при
ошибках доставки; это поведение не менялось. Клиентский api() сохраняет
серверное сообщение и один раз повторяет 503 с прежним requestKey.

Для владельца теперь понятен подтверждённый финансовый результат даже при
сбое чтения профиля. Новые таблицы, зависимости, env и UI не добавлены.

## Проверки

- Исходный profile-after-COMMIT тест воспроизвёл проблему до правки.
- Пять новых тестов: подтверждённая отмена и replay; BEGIN/cancel/COMMIT
  ошибки без ложного подтверждения; 200/replay/provider ok=false; invalid
  reason/key; настоящий Express HTTP, gateway и клиентский api() с retry.
- Engine в этих пяти тестах подменён. Дополнительно временная SQL-фикстура
  из #186 исполнила фактический cancel engine и owner handler на PGlite:
  семь сценариев прошли, включая profile error после COMMIT, сохранённые
  journal/wallet/beer и отсутствие повторной мутации. Фикстура удалена;
  незамерженный test-only PR автоматически не включён в эту ветку.
- npm ci; materialize дважды: SHA-256 всех tracked файлов после проходов
  совпадают. Generated файлы восстановлены, сохранён только handler diff.
- node --test после полной materialize: 441/441, 0 fail/skip.
- npm run check и VK startup parity PASS. Пять новых tests также PASS
  на canonical runtime после восстановления generated файлов.
- npm audit: прежние 3 moderate, 0 high/critical; отдельное исправление #180.
- Read-only production probe: 16/16 публичных VK/TG проверок, main SHA прежний.

## Границы и следующий шаг

Не проверены signed-in admin desktop/mobile, новое auth/permission покрытие,
независимые соединения PostgreSQL и реальная Telegram-доставка. HTTP test
проверяет границу owner handler/gateway, а не session middleware. Production
данные не изменялись, массовые сообщения не отправлялись, merge/deploy нет.
Universal-server использует существующий proxy к owner route; startup parity
проверен, дублирующий handler не добавлялся. При ревью учесть пересечение
этого handler с #185, не считать acquisition fix включённым сюда.

Следующий небольшой этап — такое же различение сохранённой отмены и ошибки
post-COMMIT ответа сотруднику, с проверкой квоты и профиля.

# Совместная проверка UI и серверной отмены — 2026-10-03

## Состояние и выбранный этап

Проверены fetch/status/history/remotes/worktrees, origin/main, origin-ветки,
открытые PR и CI. Main остаётся 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Эта ветка начинается от него. ops/MODULE-MAP.md прочитан; применимых AGENTS.md
не найдено. Исходные starter-pack и база знаний изучены ранее. Рабочие копии
сохранены. Новая origin/feat/league-season-champions-20261003 найдена и не включена.

У #189 release gate и VK parity зелёные. Отдельный Observe public startup
37122071915 упал при проверке текущего production gateway, а не UI branch:
Selectel /healthz и /readyz — connect timeout, IPv4 transport — PROBE_TIMEOUT,
CORS — ETIMEDOUT. Это записано отдельно от локальной совместимости изменений.

Выбран один близкий к завершению этап существующей отмены: проверить #187,
#188 и #189 вместе на изолированном стенде. До этого SQL, HTTP и UI проверялись
по отдельности; не была доказана связка response serializer → gateway → api retry
→ UI state и последующее восстановление квоты/полного modal.

| Функция | Найденная реализация | Проверенность | Конкретный пробел | Следующий шаг |
|---|---|---|---|---|
| Касса / Эвотор | draft #174 | Импорт и два обзора найдены | Нет реального подключения/сверки | Тестовый SELL/PAYBACK источник |
| Business dashboard | draft #176 | Ранее Vitest/build/typecheck | Нет venue-scoped adapter | Ревью существующей ветки |
| CRM | main directory, pagination origin | Общие tests | Нет signed-in сценария | Тестовая сессия |
| Customer 360 | #115, tenant #96 | Read/action foundation | Не весь сценарий в main | Ревью существующего API |
| Корректировки бонусов | main, #182–184 | Ранее SQL/HTTP | Нет concurrent PostgreSQL/UI | Отдельный тестовый PostgreSQL |
| Отмена / UI | main, #185–189 | Здесь SQL+HTTP+browser вместе | Не была проверена связка и modal | Этот verifier; затем ревью PR |
| Telegram-рассылка | main store, retry origin | Общие tests | Нет реальной доставки/UI | Mock provider preview/retry |
| Достижения / рамки | main, Business grants origin | Общие tests | Выдача владельцем не проверена | Тестовый клиент/сессия |
| Права / аудит | main journal/auth, tenant #96 | Здесь role rejection и SQL cancel actor/reason | Legacy main не доказывает SaaS isolation | Scoped foreign-ID сценарии |

## Изменения

Добавлен только scripts/verify-cancellation-contract.mjs и этот отчёт.
Production-файлы не менялись. Verifier принимает три явных pinned git SHA,
читает источники через git show и исполняет нужные функции в фикстурах.
Он не делает merge/cherry-pick/checkout и не копирует чужие production-реализации
в ветку. Исполняются ровно выбранные незамерженные версии, а не подразумеваемый
будущий merged runtime. Совместимость общего ревью #185 сюда не входит.

Проверенные источники:
- UI #189: 4c0b5e487df44becc3da425fb9929a012e544d73;
- owner #187: b448114e8cbeea1bf8547c12cb351cae8969f42a;
- staff #188: a2e033148a15db0c96c345c53b7d5cd6212201b2.

Запуск после git fetch origin и установки штатных devDependencies:

```sh
node scripts/verify-cancellation-contract.mjs \
  4c0b5e487df44becc3da425fb9929a012e544d73 \
  b448114e8cbeea1bf8547c12cb351cae8969f42a \
  a2e033148a15db0c96c345c53b7d5cd6212201b2 \
  /path/to/chromium
```

Последний аргумент необязателен, если Playwright располагает Chromium.
Playwright предоставлен окружением, как для существующих browser smoke
scripts; зависимостей/env/services проекта не добавлено. Эта отдельная ручная
проверка не запускается автоматически node --test и требует git objects
трёх выбранных SHA. PGlite уже есть в devDependencies main.

## Что подтверждено

Исполняются реальные cancel engine, startup schema/constraints, serializer,
authRequired/requireRole, getCancellationQuota SQL, Express HTTP, universal proxy,
api() и row/click/filter functions клиента. В браузере используется index.html
и CSS текущей ветки. Для owner открыт настоящий modal всех транзакций.

VK/TG режимы × staff/admin × 390/1440 px: 8 комбинаций, 20 совместных сценариев:
- Успех POST при отказе последующего refresh оставляет cancelled row, без кнопки.
- Profile failure после COMMIT возвращает подтверждённый 503 через gateway.
- Staff quota failure после COMMIT даёт тот же confirmed contract.
- Реальный api() повторяет 503 ровно один раз. Wallet остаётся 75, а журнал —
  cancelled; новая отмена/повторный возврат не происходит.
- После восстановления чтения staff quota показывает «осталось 2», повторная
  кнопка для отменённой записи не появляется. Owner modal обновляется тем же
  filterAdminTransactions без повторного POST.

В каждой из 8 комбинаций дополнительно проверены 401, 403, короткая причина
400, конфликт причины при прежнем ключе 409 и реальный SQL CHECK failure 500.
Это 40 отрицательных проверок через HTTP. Auth/session signer и identity mapping
предоставлены фикстурой; роль проверяет фактический requireRole. CHECK failure
происходит после изменения кошелька и откатывает транзакцию: wallet=100 и journal
completed. Фикстуры не запускают server startup jobs и не касаются production-БД.

Польза владельцу — подтверждена совместимость подготовленного сценария:
сохранённая отмена видна в UI при временном сбое, повтор запроса не возвращает
бонусы дважды, а после восстановления квота и полная история приходят с сервера.
Новой production-возможности этот test-only PR не добавляет.

## Обязательные проверки и runtime

- npm ci; materialize дважды: tracked SHA-256 совпадают. Generated изменения
  восстановлены; код из drafts в materialize chain не переносился.
- node --test: 436/436, 0 fail/skip; npm run check и VK startup parity PASS.
- Verifier отдельно PASS, включая повторный запуск на canonical runtime.
- npm audit: прежние 3 moderate, 0 high/critical, отдельное исправление #180.
- Read-only Railway probe: 16/16 reachable responses, прежний main release SHA.
- Selectel gateway /healthz в текущем окружении также не ответил за 10 секунд
  (HTTP 000 / curl timeout), как и в публичном CI. Это не доказывает полный
  outage из всех сетей; VK startup через этот gateway сейчас не подтверждён.
  CI наблюдение: https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37122071915

## Ограничения и следующий шаг

Нет signed-in production-сессии, настоящей VK/TG launch validation, PIN login,
реальной Telegram-доставки и independent PostgreSQL concurrency. getProfile,
sendTelegramMessage, session verification/effective identity и resolveActingStaff
подменены; getCurrentShift — небольшой SQL adapter реальных fixture tables.
Loader adapters перечитывают реальные HTTP history endpoints, но не выполняют
весь dashboard loadAdmin с content/inquiries/settings. Исходные main функции
не включаются целиком с фоновыми задачами. Полное объединение PR и deployment
не проверялись и не выполнялись. SQL schema fixture upgrades не являются migration.

Следующий небольшой этап — read-only диагностика доступности Selectel gateway
с независимой сети и сравнение /healthz, /readyz, TLS и CORS. Не менять
production-конфигурацию автоматически и не скрывать failed observation CI.

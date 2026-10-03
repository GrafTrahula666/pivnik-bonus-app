# UI подтверждённой отмены — 2026-10-03

## Реальное состояние и этап

Проверены fetch/status/history/remotes/worktrees, актуальный origin/main,
origin-ветки и открытые PR. Main: 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Новая ветка начинается от него. ops/MODULE-MAP.md прочитан, применимых
AGENTS.md не найдено. starter-pack и база знаний изучены ранее. Чужие
рабочие копии и незамерженные реализации не переносились. #180–188 остаются
отдельными PR. Обе проверки #188 зелёные (37118769326/37118769354).

Выбран один UI-этап существующего сценария отмены. В main successful POST
и последующее обновление истории находятся в одном try/catch. Если отмена
сохранена, а refresh падает, интерфейс показывает обычную ошибку и старую
строку с кнопкой «Отменить». Дополнительно специальные подтверждённые 503
ответы #187/#188 раньше только показывали toast и не обновляли строку.
Это мешает владельцу/сотруднику понять результат финансового действия.

| Функция | Найденная реализация | Проверенность | Конкретный пробел | Следующий шаг |
|---|---|---|---|---|
| Касса / Эвотор | draft #174, origin evotor-sales | Импорт и два обзора найдены | Нет реальной сверки | Тестовые продажи/возвраты |
| Business dashboard | draft #176 | Ранее Vitest/build/typecheck | Нет venue-scoped adapter | Ревью #181 и adapter |
| CRM | main directory, pagination origin | Общие tests проходят | Signed-in поиск не проверен | Тестовая сессия |
| Customer 360 | #115, tenant #96 | Read/action foundation найден | Не включён весь сценарий | Ревью существующей карточки |
| Корректировки бонусов | main, #182–184 | Ранее HTTP/SQL проверки | Нет production-like concurrency/UI | Тестовый PostgreSQL |
| Отмена операций | main handlers/UI, #185–188 | Здесь client logic и desktop/mobile fixtures | Refresh failure скрывал подтверждённый результат | Этот UI этап; затем серверное ревью |
| Telegram-рассылка | main store, retry origin | Общие tests | Нет реальной доставки/UI | Provider mock preview/retry |
| Достижения / рамки | main, Business grants origin | Общие tests | Owner выдача не проверена | Тестовый клиент/сессия |
| Права / аудит | main authorization/journal, #96 tenant | Предыдущие route/SQL guards | Legacy main не доказывает SaaS isolation | Scoped foreign-ID сценарии |

## Что изменено

В app.js общий cancelOperation для двух существующих кнопок. На время POST
кнопка отключается и показывает «Отмена…». Только подтверждённая transaction
со status=cancelled и совпадающим ID обновляет локальную строку. В staff/admin
истории сохраняется статус отмены до повторного чтения; кнопка исчезает.

Для error response дополнительно строго проверяются HTTP 503,
code=cancellation_committed, cancelled=true. Неподтверждённые ошибки, 403,
чужой ID и неверный contract не превращаются в локальный успех. Это совместимость
с #187/#188; их серверный код сюда не включён. Пока они не интегрированы,
специальный 503 путь доступен только в fixtures. Existing 200 success с main
уже обрабатывается независимо от последующей ошибки refresh.

Обновления истории/лиги идут через allSettled. При отказе чтения сообщение
сохраняет «Операция отменена» и объясняет, что данные не обновились.
Отсутствующая квота явно показана как недоступная; дальнейшие staff cancel
кнопки не предлагаются до успешного обновления истории. Баланс локально не
пересчитывается: без свежего client response отмечается необходимость обновить
профиль. Сумма старого профиля остаётся в памяти и не выдаётся за новый баланс.
Существующая кнопка обновления истории сохранена. CSS/темы не менялись.

Для владельца результат финансового действия больше не зависит от того,
удалось ли одновременно перечитать интерфейс. Сервер по-прежнему отвечает
за права, журнал и идемпотентность; UI не заменяет эти проверки.

## Проверки

- Пять новых Node-тестов фактических client functions: success + refresh
  failure для staff/admin; подтверждённый 503 и недоступная квота/профиль;
  invalid contract/foreign ID/403/400/500; повторный клик во время POST;
  неполный 200 response. Эти fixtures не выполняют SQL/серверный auth.
- Browser smoke исполняет реальные row renderers/click handlers app.js на
  index.html и существующем CSS, с фиктивными POST и refresh. VK/TG × staff/admin
  × 1440×1000 / 390×844: все 8 комбинаций проходят, 24 сценария denial/success/
  confirmed-503. Проверены enabled после 403, отсутствие кнопки после подтверждения,
  cancelled state, пояснение квоты и отсутствие horizontal overflow списка.
  Снимки mobile/desktop визуально просмотрены. Toast на mobile перекрывает
  часть строки по существующему стилю, затем исчезает штатным toast timer в app.
- scripts/cancellation-ui-browser-smoke.mjs сохранён для повторного запуска.
  Требует предоставленного Playwright/Chromium как прежние browser smoke scripts;
  необязательный аргумент — путь к Chromium. Зависимости проекта не добавлены.
  В этом окружении CDN-download Playwright не удался; использован Chromium из
  уже доступного compressed browser package, распакованный в отдельную scratch-копию.
- npm ci; полная materialize дважды с одинаковыми tracked SHA-256.
- node --test после materialize: 441/441, 0 fail/skip; npm run check и VK parity PASS.
- Пять новых tests повторно PASS на canonical client после восстановления
  generated файлов. Только выбранные client blocks сохранены в diff.
- npm audit: прежние 3 moderate, 0 high/critical, отдельный #180.
- Read-only production probe: 16/16 reachable responses, прежний main SHA.

## Непроверенное и следующий шаг

Нет signed-in production-сессии. Browser fixtures блокируют app bootstrap и
внешние сервисы: это проверка выбранных client render/click functions, а не
полный реальный VK/TG login. Реальная PostgreSQL concurrency и доставка Telegram
не проверены. Открытый modal со всеми транзакциями отдельно не проверялся;
использует существующий filterAdminTransactions и те же кнопки/renderer.

Новые 503 UX сценарии требуют интеграции существующих #187/#188. При ревью
это явная зависимость contract, а не включение их серверного кода. Production-БД,
массовые сообщения, merge/deploy не затронуты. Следующий небольшой этап:
проверить этот client с серверными cancel handlers на общем изолированном
стенде, включая открытый modal и восстановление квоты после refresh.

# Подготовить CRM без настройки гостевого приложения

В разрешённом тестовом контуре включите `ADMIN_ENABLE_CRM_ONBOARDING` вместе
с существующими `ADMIN_ENABLE_WRITES` и `ADMIN_ENABLE_ONBOARDING_DRAFTS`.
Для владельца/приглашённого сотрудника нужен существующий invitation mode
и действующие company/draft grants. Новый флаг по умолчанию false.
Production env этим документом не меняются.

1. Войдите владельцем компании или управляющим с действующим приглашением.
2. Создайте и сохраните черновик заведения в разрешённой организации.
3. Нажмите «Подготовить CRM». Тема, цвета и гостевой магазин не обязательны.
4. Продолжите подготовку базы и подключение кассы в существующем мастере.

Подготовка создаёт только metadata. Заведение выключено, CRM не запущена;
доступ к клиентской базе, касса и подписка требуют своих серверных проверок.
Выделенная БД/миграции/гостевое приложение автоматически не создаются.
При потере ответа откройте сохранённую область. Повтор той же команды
возвращает ту же каноническую точку. Данные других магазинов не используются.

API: `POST /api/admin/onboarding/drafts/:id/crm/prepare`, тело
`{"draftRevision":1}`. Query, scope, credentials, app config, статус и
applicationRevision из браузера запрещены. Ответ — существующий scope contract
со статусом prepared/not_provisioned; не активная CRM. Старая конфигурация
приложения сохраняется. Старая PUT scope-команда не получает CRM defaults.

При выключенном флаге — HTTP 403. Просроченная ревизия — 409, чужой draft —
404, недействующий write grant — 403/404. Ошибка любого аудита откатывает
изменения полностью. Гостевые branding поля в новом режиме скрыты; прежний
режим доступен при выключенном флаге. Роли и company owner grants не меняются.

Проверки используют native PostgreSQL/PGlite и только синтетические fixtures:

```sh
npx vitest run server/tests/crm-preparation.spec.ts server/tests/venue-onboarding.spec.ts --maxWorkers=1
SPACEVERSE_E2E_CRM_PREPARATION=true npx playwright test -c playwright.tenant-crm.config.ts
```

Browser требует существующий локальный test PostgreSQL из CRM runbook.
Полный короткий мастер из четырёх этапов, безопасный bootstrap базы и реальный
Market install/pay/revoke пока не завершены. Эта команда убирает один лишний
обязательный шаг; commercial activation ею не подтверждается.

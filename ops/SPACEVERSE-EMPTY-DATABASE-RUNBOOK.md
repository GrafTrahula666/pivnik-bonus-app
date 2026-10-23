# Подготовка пустой базы CRM

Это следующий участок существующего Venue Onboarding. База должна быть заранее
создана и зарегистрирована инфраструктурой по canonical runtime key. Команда
не создаёт облачный PostgreSQL, credentials или второй tenant registry.

## В разрешённом тестовом контуре

1. Используйте существующие `ADMIN_ENABLE_WRITES`, `ADMIN_ENABLE_ONBOARDING_DRAFTS`,
   `ADMIN_ENABLE_ONBOARDING_PROVISIONING`; для приглашённого сотрудника —
   существующий invitation mode и действующие grants.
2. Отдельно включите `ADMIN_ENABLE_ONBOARDING_DATABASE_BOOTSTRAP=true`
   (по умолчанию false). Это разрешение исполнить фиксированные миграции по
   явной команде владельца, не запуск миграций на startup.
3. Зарегистрируйте **новую полностью пустую отдельную базу** в существующем
   `ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON`. Credentials остаются в серверном
   `SPACEVERSE_TENANT_DATABASE_URL_*`; в браузер URL не вводится. Реестр
   запрещает Admin/legacy URL, общие targets и повторные secret references.
4. В сохранённом мастере выберите «Подготовить привязку». Существующий POST
   `.../provisioning/runtime-database-binding/run` принимает только `{}`.
5. После успешной подготовки выполните отдельную «Проверить схему».

При отключённом новом флаге прежний режим привязки не меняется: нужны вручную
подготовленные миграции 017/018. Даже с флагом уже существующая binding-таблица
не означает разрешение достраивать произвольную базу. Такой target проходит
прежнюю проверку точного binding; недостающую схему выявляет read-only проверка.

## Что реально выполняет команда

В **одной target-транзакции** берётся фиксированный advisory lock, выставляются
ограничения SQL/lock wait и безопасный search path с системными функциями первыми.
Если public binding отсутствует, проверяются существующие relations, routines,
типы, дополнительные схемы, extensions, event triggers, foreign servers,
large objects и temporary objects текущей session. Даже пустая чужая таблица
означает `TARGET_DATABASE_NOT_EMPTY`; объекты не принимаются и не удаляются.

Только после empty-preflight выполняются новая нумерованная
`admin-platform/tenant-migrations/001_customer_core.sql` и существующие canonical
root-миграции 009, 017–020. Их внешние BEGIN/COMMIT снимает фиксированный loader;
DO blocks сохраняются. Core SQL отдельно требует transaction-local approval и
самостоятельно без команды не применяется. Старые миграции не изменены.

Core содержит минимальную основу существующих customer auth/read/wallet
контрактов. Это не полный legacy PIVNIK runtime/schema и не готовность финансовых
операций. Публичная связь с Telegram/VK не требуется от нового бизнеса.
Клиенты, wallets, identities, transactions, ownership и request ledger создаются
пустыми. Записывается только точный singleton binding текущего manifest/scope.

Любая ошибка DDL или binding откатывает **всю** новую схему. Уже привязанный target
можно только сверить; другой runtime/company/venue никогда не перезаписывается.
Shared Admin-данные, production `users/wallets/purchases`, реальные ключи и кассы
не являются target этого сценария и не меняются.

## Повтор, отзыв и потеря ответа

Используется тот же provisioning ledger/lease, без нового шага/таблицы tenant.
Действующий lease блокирует повтор; истёкший lease допускает reconciliation.
Роль/active account и canonical write grant повторно проверяются до claim и
подтверждения результата. Lease измеряется `clock_timestamp()`, в том числе
после ожидания metadata locks. Старый worker не подтверждает истёкшую попытку.

Target commit и metadata commit не являются общей транзакцией. Если target уже
сохранился, а ответ/audit/metadata confirmation потеряны, UI не обещает успех;
нужно обновить состояние и повторить после истечения lease. Новый worker сверит
ту же привязку и не запустит DDL повторно. При отзыве доступа после target commit
подтверждение запрещено; отдельная пустая схема может остаться подготовленной.
Автоматического удаления/компенсирующего DROP нет.

Успех подготовки не включает venue/runtime, подписку или кассу. Всё ещё
`prepared`, `not_provisioned`, `published=false`. Проверка схемы остаётся отдельной
read-only операцией; Market и живая касса проверяются независимо.

## Проверка

```sh
cd admin-platform
npm exec --no -- vitest run server/tests/onboarding-tenant-bootstrap.spec.ts --maxWorkers=1
SPACEVERSE_E2E_DATABASE_BOOTSTRAP=true npx playwright test -c playwright.tenant-crm.config.ts
```

Для native SQL и браузера используется существующий loopback-only
`SPACEVERSE_TEST_NATIVE_POSTGRES_URL` с ролью `crm_fixture` и новой test DB.
В fixture создаются новые отдельные базы; прежние данные не удаляются.
Production env/DB, расписания, Railway settings и устройства этим runbook не
изменяются. C13 остаётся частичным до автоматического безопасного выделения
самого ресурса и полноценного self-service runner.

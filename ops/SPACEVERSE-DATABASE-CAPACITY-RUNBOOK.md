# Резерв выделенных баз для самостоятельного подключения CRM

Резерв добавляется к существующему protected database registry. Это не новый
tenant registry: компания/точка/runtime остаются в прежних canonical metadata,
а новая allocation-таблица содержит только закреплённый ресурс без credentials.
Веб-сервер не получает CREATE DATABASE/роль cloud API и не создаёт платные ресурсы.

## Подготовка разрешённого контура

1. Инфраструктура заранее создаёт отдельные пустые PostgreSQL базы и ограниченные
   credentials. Нельзя включать Admin/legacy/чужую или общую базу.
2. Вручную примените новую Admin migration
   `018_onboarding_database_capacity.sql` после 017. Она создаёт только пустую
   таблицу reservations и дополнительные UNIQUE indexes, без backfill/startup.
3. Включите существующие CRM onboarding, provisioning, empty-database bootstrap
   и отдельный `ADMIN_ENABLE_ONBOARDING_DATABASE_CAPACITY=true` (default false).
   Writes/drafts/invitation permissions сохраняются; без зависимости сервер
   отказывает при startup validation. Пауза writes не требует выключать сервер.
4. Защитите URL через прежний формат `SPACEVERSE_TENANT_DATABASE_URL_*`.
   `ADMIN_ONBOARDING_DATABASE_CAPACITY_JSON` содержит только slot/reference:

```json
{"capacity-first":{"credentialEnv":"SPACEVERSE_TENANT_DATABASE_URL_RESERVE_A"}}
```

Резерв и старые explicit-runtime entries не могут повторять secret references
или host/port/database identity и не могут указывать на Admin/legacy DB.
Transport сохраняет прежнюю TLS/CA проверку. Отсутствующий secret не создаёт
доступный slot. Добавление новых slot definitions требует обновления защищённой
конфигурации процесса; это не команда в браузере. Production этим документом
не изменяется. Текущий формат ограничен 200 capacity entries; автоматическое
пополнение, глобальные connection quotas и тысячи клиентов — отдельный этап.

## Действия владельца

Сохранить компанию/точку → «Подготовить привязку» → «Проверить схему».
Промежуточная привязка runtime к env для каждой точки больше не нужна.
Запрос остаётся прежним POST `.../runtime-database-binding/run` с `{}`.
Выбирать slot, передавать URL/SQL/company/venue клиенту запрещено.

В той же metadata-транзакции, что claim существующего binding step, сервер
блокирует актуальный account/grant/frozen draft, берёт общий короткий advisory
lock и резервирует один свободный slot. UNIQUE draft/runtime/slot/identity и
canonical composite FK запрещают двойную выдачу. Allocation audit атомарен с
reservation/claim; его ошибка откатывает оба, до обращения к target.

После metadata commit прежний bootstrap проверяет пустоту target и атомарно
создаёт canonical customer schema + точный binding. Readiness остаётся
независимой read-only проверкой. Никаких customer/financial данных не копируется.
GET/диагностика/read registry не выделяют ресурсы.

## Отказы и восстановление

- Резерв пуст/исчерпан: operation action_required с фиксированным
  `TARGET_DATABASE_CAPACITY_EXHAUSTED`; workflow provisioning — pending.
  Черновик, введённые ключи и scope сохраняются. После пополнения повтор
  резервирует ресурс для того же draft, не создавая новую точку.
- Target уже содержит объекты: прежний `TARGET_DATABASE_NOT_EMPTY`.
  Чужие данные не принимаются и не удаляются; reservation не перераспределяется.
- Ответ потерян после target commit: повтор сохраняет тот же allocation и
  сверяет прежний binding; дубля ресурса/audit не создаёт.
- Пароль той же базы можно ротировать: меняется pool, identity остаётся той же.
  Перенаправление slot URL на другую host/port/database отклоняется сравнением
  сохранённого fingerprint; новая пустая база автоматически не подставляется.
- Удалённый/сломанный slot или corrupted source reservation требуют поддержки;
  никакого автоматического reclaim/recycle/DROP. Истёкший lease, смена роли,
  revoke и canonical source продолжают проверяться прежним provisioning.
- Existing explicit runtime mapping сохраняется при выключенном новом флаге.
  При включённом flag нельзя перекрыть persisted allocation explicit mapping:
  это ошибка конфигурации, а не разрешение перенести данные.

Успех выдачи/схемы оставляет venue inactive, runtime not_provisioned и
published=false. Установка/подписка/касса не подтверждаются этим действием.
Лицензионные quotas и официальные Market callbacks пока не реализованы;
включать это в production для платных клиентов без остальных release gates нельзя.

## Проверка на синтетическом локальном PostgreSQL

```sh
cd admin-platform
npm exec --no -- vitest run server/tests/onboarding-database-capacity.spec.ts server/tests/onboarding-database-registry.spec.ts --maxWorkers=1
SPACEVERSE_E2E_DATABASE_CAPACITY=true npx playwright test -c playwright.tenant-crm.config.ts
SPACEVERSE_E2E_DATABASE_CAPACITY=true SPACEVERSE_E2E_DATABASE_CAPACITY_EMPTY=true npx playwright test -c playwright.tenant-crm.config.ts
```

Browser/native fixtures используют только отдельный loopback `crm_fixture`
контур. При отсутствии native URL SQL tests используют PGlite; реальные
cross-connection concurrency проверяются в native contour. Test DBs сохраняются,
прежние данные не удаляются. Возможный сбой ни разу не трактуется как «подключено».

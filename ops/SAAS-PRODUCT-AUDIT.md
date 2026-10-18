# SPACEVERSE CRM — аудит готовности SaaS

Дата: 18 октября 2026. База: `origin/main` **5230083e88e32ec2618647ca0d0f9f9cfd60c872**. Объект — существующий `admin-platform/` и сайт https://admin-pilot-production.up.railway.app/. Новое ТЗ возвращает Эвотор.Маркет как канал коммерческой публикации этого продукта. Киоск, товароучёт и переписывание проекта исключены.

## Вывод

Есть работающая панель для ПИВНИКА и существенная основа изолированного onboarding. **Коммерческая CRM для нового независимого бизнеса пока не готова.** Главные разрывы: самостоятельный CRM read/write path для стороннего tenant, завершение активации точки без ручного оператора, проверенный контракт установки/лицензии Маркета. Число существующих тестов не означает готовность этих сценариев.

## Источники и границы проверки

- `git fetch origin ...main`, `git log`, `git ls-remote --heads origin`: 330 удалённых веток; `gh pr list --state open --limit 100`: 58 открытых PR на момент исследования.
- Прочитаны актуальные части [MODULE-MAP](MODULE-MAP.md), ограничения Do not break, код React/Admin API, миграции, tenant registry, кассовая аналитика, настройки тестов и релизный workflow.
- Read-only проверки публичного сайта: `/` — HTTP 200, title «SPACEVERSE — Панель владельца»; `/api/admin/health` — HTTP 200 / `ok=true`; `/api/admin/auth/session` без cookie — `authenticated=false`, `demo=true`, `invitations=false`.
- Это не проверка закрытых экранов владельца и не доказательство версии Admin deployment. Production-учётные записи, ключи, БД и настройки Railway не читались/не менялись.
- [ARCHITECTURE.md](../admin-platform/ARCHITECTURE.md) описывает старую Phase A с demo-only и отсутствующим production repository. Эти утверждения больше не описывают текущий код; документ нельзя использовать как текущую карту архитектуры.

Статусы ниже: **есть** — подтверждено кодом в указанном контуре; **частично** — реализован ограниченный сценарий; **нет в просмотренном контуре** — не найден полный рабочий путь; **внешняя проверка** — требуется доступ/действие вне репозитория.

## Матрица готовности

| Возможность | Состояние | Доказательство и практическое ограничение |
|---|---|---|
| React/TS сайт и отдельный Admin API | Есть | [App](../admin-platform/src/App.tsx), [server/index](../admin-platform/server/index.ts), отдельный [Dockerfile](../admin-platform/Dockerfile) |
| Вход, session cookie, CSRF, Origin, rate limits | Есть | [auth](../admin-platform/server/auth.ts), [security](../admin-platform/server/security.ts), HTTP security tests; это Admin auth, не универсальная идентификация клиентов бизнеса |
| Company/venue scope | Есть с ограничениями | [tenant](../admin-platform/server/tenant.ts); canonical companies/venues и server-derived scope. Основной доступ по компании; scoped invite grants — отдельный существующий ledger |
| Роли | Частично | SUPER_ADMIN/VENUE_ADMIN, owner/trusted, invitation owner/manager/viewer. Отдельная коммерческая матрица аналитика/сотрудника ещё не доведена до всех рабочих маршрутов |
| Приглашения, expiry/revoke/одноразовость | Частично | [onboarding-invitations](../admin-platform/server/onboarding-invitations.ts); default-off; есть signed HTTP/SQL и browser fixtures. Публичный индикатор invitations сейчас false |
| Создание компании и точки | Частично | [venue-onboarding](../admin-platform/server/venue-onboarding.ts) резервирует canonical IDs с `active=false`; подготовка не равна работающей CRM |
| Возврат к мастеру и статусы | Есть в opt-in мастере | [onboarding-workflow](../admin-platform/server/onboarding-workflow.ts), progress migration 012; сохранение выбора, честные pending/not_provisioned |
| Шифрование ключа провайдера | Есть в мастере | [onboarding-secrets](../admin-platform/server/onboarding-secrets.ts), AES-256-GCM, scoped AAD, key rotation, маска в ответах |
| Проверка Эвотора | Частично | Documents-read и proxy v2 с реальным событием предусмотрены кодом; не доказывают установку из Маркета или полный импорт для нового бизнеса |
| Provisioning | Частично | [registry](../admin-platform/server/onboarding-database-registry.ts) и [ledger](../admin-platform/server/onboarding-provisioning.ts); target DB/migrations/credential references готовятся оператором. Самообслуживание без разработчика не завершено |
| Самостоятельная CRM сторонней компании | Блокер | [data.ts:requireLegacyBar](../admin-platform/server/data.ts#L62) отклоняет `companyCode !== 'pivnik'`. Снимать этот guard для доступа к общей legacy-БД нельзя |
| Клиентская ownership-модель | Есть основа | [019](../migrations/019_spaceverse_customer_ownership.sql), [customer-wallet-repository](../customer-wallet-repository.js); точная runtime/company/venue ownership без backfill. Admin CRM ещё не подключена к ней полностью |
| Customer 360 | Частично, ПИВНИК | Чтение профиля, операций, бонусов и специфических наград. Нет подтверждённого общего CRUD/импорта контактной базы стороннего бизнеса |
| Поиск и сегменты | Частично | Поиск выполняется сервером по всему разрешённому набору; API умеет limit/offset. ProductionCRM запрашивает максимум 100 строк без UI-пагинации; сегменты фиксированные |
| Кассовая аналитика | Есть ограниченный контур | [evotor-read](../admin-platform/server/evotor-read.ts), [pos/analytics](../pos/analytics.js): продажи/возвраты, время, товары из кассы, привязанные/анонимные продажи, пусто/нет связи различимы |
| RFM, когорты, retention, LTV | Нет полного общего пути | Фиксированные purchase-сегменты не равны RFM. Visits/DAU/retention возвращают unavailable, когда отсутствуют события; прогнозный LTV не реализован |
| Аналитическая лаборатория | Нет в просмотренном контуре | ProductionAnalytics — набор фиксированных показателей. Нет общего конструктора осей/формул, сохранённых dashboard definitions и полного CSV/XLSX/PDF pipeline |
| Маркетинговые автоматизации | Частично, ПИВНИК | Акции/рассылки существуют. Полного tenant-safe trigger engine, измерения incremental lift/A/B и общих согласий для новых бизнесов не подтверждено |
| Подписка/лицензия/AI add-on | Нет полного пути | `admin_customer_entitlements` — выдача клиентских наград, **не** коммерческие права тарифа CRM. Полный lifecycle лицензии Маркета не найден |
| AI | Существует отдельный UI draft | #101 — старый dashboard shell без API; не готовый React/Admin AI module. Внешние платные вызовы в этой задаче запрещены |
| Поддержка | Частично | OwnerVenues копирует текст обращения/диагностику; это не сохранённый/доставленный ticket с жизненным циклом |
| Mobile UX | Частично проверено | Есть responsive CSS и fixture E2E. Закрытые реальные сценарии onboarding/CRM/оплаты на телефоне не подтверждены целиком |

## Технические риски и приёмка

| ID | Приоритет | Подтверждение | Что нужно для снятия |
|---|---|---|---|
| R01 | P0 | CRM стороннего бизнеса запрещена legacy guard | Изолированный Admin CRM adapter на существующей ownership-модели; две компании/две точки, CRUD/read/search HTTP+SQL/E2E; без доступа к legacy-данным |
| R02 | P0 | Новый scope inactive; registry требует ручных DB/env references | Одобренный resumable provisioning/activation для CRM, без обязательного гостевого приложения; real source verification и повтор после сбоя |
| R03 | P0 | Нет проверенного install/license контракта Маркета | Подтверждённые официальные правила, подлинность событий, lifecycle/idempotency, серверные entitlement gates |
| R04 | P0, исправлено в ветке | CRM сохраняла таблицу/карточку при смене scope | Воспроизведены 3 browser failures на неизменённом UI: соседняя точка, другая компания, поздний ответ. После исправления 6/6 desktop/mobile проходят. Серверный обход авторизации этим не доказан; merge/deploy ещё не выполнялись |
| R05 | P0 перед коммерческим запуском через публичный DB endpoint | [db.ts](../admin-platform/server/db.ts) использует `rejectUnauthorized:false` для внешних Admin pools | Отдельная проверенная TLS/CA политика и интеграционный тест с проверкой сертификата. Фактический production DSN/CA не исследован; текущие настройки не переключать вслепую |
| R06 | P1 | [migrate.ts](../admin-platform/server/migrate.ts) требует `public.bars` | Явный проверенный bootstrap standalone CRM с существующими canonical tables; не ослаблять legacy preflight и не создавать вторую tenant-модель |
| R07 | P1 | Поиск без UI-пагинации; static LivePill заявляет обновление без привязки к ответу | Серверная пагинация в UI, источник/дата/freshness, различение ошибок и пустых результатов |
| R08 | P1 | Общие роли, consent/retention, support и мониторинг неполны | Permission matrix, аудит, обработка персональных данных, тест восстановления, реальные support tickets |
| R09 | P1, локально проверено в #284 | PostgreSQL integration suite требует отдельную тестовую БД | Изолированный PostgreSQL 16: 20 прежних + 19 новых HTTP cases passed; production-mode image smoke с real registry passed. CI без test URL по-прежнему пропускает 20; внешняя TLS/CA и коммерческий сценарий остаются отдельными gates |

## Что уже ведётся в других ветках

- [#101](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/101): AI Analyst shell в старых root dashboard modules; submit disabled, внешних расходов нет. Использовать вопросы/UX как исходный материал, не вносить старую ветку целиком в React-панель.
- [#115](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/115), [#197](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/197), [#212](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/212): Customer 360/ownership/HTTP evidence — согласовать перед новой реализацией.
- [#210](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/210): существующий draft кассового reader; часть функциональности уже в main, не импортировать PR оптом.
- [#280](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/280), [#281](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/281), [#282](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/282): активная работа с реальным Evotor bridge/sync; не изменять в этой итерации.
- Существуют старые ветки pagination/remount. Проверка текущего кода и branch diff обязательна: имя ветки не доказывает наличие исправления. Проверенная remount-ветка — предок main и не закрывает R04 в текущем App.

## Первый исполняемый шаг

Текущая ветка добавляет эти пять документов и исправляет только R04: lifecycle CRM привязан к actor/company/venue, карточка — к клиенту, поздние ответы игнорируются. Финансовая логика, backend permissions, модели и CI workflows не меняются. Это исправление существующего поведения; новые production-модули не включаются. Смена scope должна сразу очищать таблицу, открытые формы и карточку ещё до ответа новой точки.

Свежие команды/результаты и materialize diff фиксируются в [progress](SPACEVERSE-ONBOARDING-PROGRESS.md). Полный продукт не объявляется готовым по результату этого PR. Следующие обязательные шаги и внешние действия — в [roadmap](SAAS-PRODUCT-ROADMAP.md).

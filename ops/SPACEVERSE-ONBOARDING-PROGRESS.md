# SPACEVERSE — мастер подключения заведений

## Контрольная точка

- Ветка: `spaceverse/venue-onboarding`; один связанный draft PR #273, открыт; reviews/threads отсутствуют. Mergeability перепроверять после публикации нового HEAD.
- Проверенный свежий base: `3d3d1935f6885f6dca49ceb59d55e7af9118096a` (main, получен 2026-10-13; включает merged PR #235/#238/#250). Он влит в рабочую ветку merge-коммитом `e6678123f0f37ccd826e5ac0e5dd11975bfa7855` без конфликтов; оба POS mount, wallet-route extraction и tenant preflight сохранены.
- Свежий опубликованный HEAD рабочей ветки перед этой итерацией: `1d9c0ed97e3b2f350d217cfdf8c62a6550291ddf`. Он добавляет серверные статусы/сохранённый шаг мастера поверх ранее опубликованного status/start UI; изменения сохранены при rebase. Текущий кандидат добавляет read-only готовность схемы опубликованными объектами `d290748950689ab302dba0b86a7db73d19ad8166` и `8233f54826a144ed444f15f158a53d7011344185`; итоговый docs/PR HEAD нужно читать из GitHub/`git rev-parse` после публикации журнала.
- Связанный PR искать по head `spaceverse/venue-onboarding`; его CI должен соответствовать текущему опубликованному SHA, а не старому прогону.
- Текущий HEAD нужно читать из GitHub/`git rev-parse HEAD`, не считать этот исходный SHA актуальным main.
- Основной checkout `verify/trusted-director-release-20261011` с чужими изменениями сохранён. Работа идёт в отдельном worktree.
- Перед продолжением проверить свежий main, PR, CI и пересечения с «SPACEVERSE Business — развитие». Не создавать вторую ветку/дубликат PR.

## Цель и этапы

1. **Данные заведения, серверный черновик, повторное открытие** — реализовано и проверено в изолированном окружении.
2. **Принадлежность tenant и конфигурация guest-приложения** — серверный blueprint, стабильный tenant ID, канонические неактивные company/venue и runtime manifest v2 реализованы. Manifest получает company/venue только из сохранённого scope; выделенная БД обязана подтвердить те же ID и checksum. Dashboard reads, запись новых transactions, чтение customer/wallet и атомарное создание нового customer/identity/wallet/ownership принимают только проверенный server runtime и повторно связывают SQL с той же выделенной БД. Customer/wallet доступны лишь через явную ownership-строку точного runtime/company/venue; исторические строки ПИВНИКА невидимы и не присваиваются новому tenant. Общий Telegram/VK auth/wallet HTTP adapter подключён в обоих runtime только за существующим startup guard; manifest остаётся `not_provisioned`, поэтому tenant-запуск намеренно закрыт.
3. **Зашифрованные подключения и реальные проверки Telegram/VK/Эвотора** — первый вертикальный срез Эвотора реализован: зашифрованное хранение, маска и реальная проверка чтения документов через существующий адаптер. POS binding/import не включены; Telegram/VK и живая авторизация владельца ещё предстоят.
4. **Возобновляемое создание ресурсов из того же релизного артефакта** — два фиксированных шага реализованы в одном серверном ledger с lease/claim/retry и тем же защищённым registry: идемпотентная фиксация exact runtime binding и следующая read-only проверка tenant-схемы/ownership. Оба имеют creator/scoped status/start API и UI recovery после reload; миграции не применяются автоматически, runtime остаётся выключен.
5. **Приглашения и гибкие права** — одноразовые scoped-приглашения owner/manager/viewer, принятие в существующую или новую `VENUE_ADMIN` учётную запись, отзыв и продолжение сохранённого мастера реализованы. Более узкие полномочия сотрудников и реальная отправка приглашений ещё предстоят.
6. **Полный сценарий, доказательство изоляции, пакет выпуска/rollback** — предстоит.

Готовность всего мастера: новая организация проходит настройку; приложение получает её конфигурацию; поддерживаемые подключения реально проверены; сотрудник входит с заданными правами; повторы/сбои восстанавливаются; чужие данные закрыты; регрессия пройдена. До отдельного одобрения production не изменяется.

## Что обнаружено и переиспользовано

- `companies`, `venues`, `admin_company_access` и tenant resolver существуют. Создания организаций в публичном Business API до этого шага нет; оно встречается в bootstrap/seed.
- Черновик хранится отдельно от активных организаций/заведений и ссылается на существующую `companies`, если оператор выбрал её. Явное действие «Подготовить область» после сохранения приложения создаёт канонические company/venue в тех же таблицах, без второй модели tenant; новые строки остаются неактивными.
- Конфигурация стандартного приложения хранится отдельно от черновика, но связана с ним внешним ключом один-к-одному. Сервер резервирует стабильный `sv-*` tenant ID; это ещё не запись в `companies` и не опубликованный runtime.
- Оба guest entrypoint исторически запускают ПИВНИК-специфичную инициализацию: gateway сначала создаёт child `server.js`, а child запускает миграции/seed. Поэтому tenant preflight установлен в обоих файлах до spawn/`initDatabase`, а не только в одном процессе.
- Runtime manifest v2 появляется только после scope и содержит его канонические company/venue ID, точные ревизии draft/application/scope, брендируемые настройки, политику `dedicated_database` и честный статус выпуска. URL БД, токены и provider credentials в него не входят; целостность проверяется SHA-256.
- Использованы настоящие `App`, Business HTTP router, подписанные сессии, Origin/CSRF и существующий аудит.
- Guest runtime исторически связан с ПИВНИКОМ; наличие companies/venues не делает его автоматически безопасным для других клиентов. Legacy read adapter уже отказывает чужим tenant.
- OAuth/права Telegram/VK/кассы требуют официальной авторизации владельца. Наличие строки токена не означает подключение.

## Реализованный шаг

- В разделах Платформа/Компании/Заведения: «Добавить заведение», существующая/новая организация, название, адрес, часовой пояс, тип, email владельца; сохранение, список и открытие последней версии.
- `GET/POST /api/admin/onboarding/drafts`, `GET/PUT .../:id`; поиск собственного запроса через `?requestKey=UUID` для восстановления потерянного ответа независимо от лимита списка.
- Доступ только `SUPER_ADMIN`. Даже другой SUPER_ADMIN не читает/изменяет чужой черновик. VENUE_ADMIN owner/trusted не имеют доступа; их существующие права/пароли не меняются.
- POST: UUID операции + нормализованный fingerprint + UNIQUE(admin_id,request_key), повтор не создаёт дубль. PUT: блокировка строки, revision и безопасный повтор идентичной подтверждённой правки; устаревшая правка получает 409.
- Черновик и аудит фиксируются одной транзакцией. В аудит не записываются контакты/полные тела; ошибки БД очищены от деталей строк.
- Неподтверждённый ответ замораживает исходную команду. В sessionStorage лежит только не секретный UUID запроса под ID администратора; данные формы/контакты/ключи туда не записываются. После reload сохранённый серверный результат восстанавливается.
- Строгий список полей: неизвестные поля, токены и самоназначение прав отвергаются. Ограничены тело запроса, длины, ID, timezone, email и частота записи.
- UI показывает «Черновик · ещё не подключено». Боты, приглашения, компания, active venue, приложения и внешние ресурсы этим шагом не создаются.
- После сохранения черновика тот же мастер настраивает безопасную часть стандартного приложения: название, тему, два цвета, магазин и базовую лояльность. Настройка сохраняется сервером, повторно открывается после reload и не хранится в browser storage.
- `GET/PUT /api/admin/onboarding/drafts/:id/application`: отдельная ревизия, блокировка черновика, безопасный повтор одинакового PUT и 409 для устаревшей правки. Конфигурацию видит только создавший её SUPER_ADMIN; owner/trusted и другой SUPER_ADMIN получают отказ/404 без утечки существования.
- Контракт всегда сообщает `template=standard`, `qrEnabled=true`, `isolationPolicy=dedicated_database`, `legacyDataAccess=false`, `runtimeStatus=not_provisioned`, `published=false`. Наличие blueprint не выдаётся за созданное приложение.
- Произвольные поля, URL, токены и неправильные типы отвергаются. Мастер прямо сообщает, что логотип и ключи Telegram/VK/кассы будут приниматься только через будущий защищённый канал.
- Создание/обновление application blueprint и audit выполняются одной транзакцией. Stable tenant ID выводится из UUID черновика и не меняется при повторе; приложение, база, бот, webhook, касса, клиенты, кошельки и операции этим шагом не создаются.
- До подготовки scope application API возвращает `runtimeManifest=null`, поэтому временный tenant key нельзя выдать за готовую область. После подготовки scope application/scope API возвращают один и тот же строгий manifest v2, собранный сервером из сохранённых canonical ID. Неизвестные поля, подмена ID/конфигурации без нового checksum и ложные статусы `ready/published` отвергаются.
- `spaceverse-runtime-manifest.js` разбирает manifest и в tenant-режиме делает один параметризованный lookup точной привязки в выбранной БД. Runtime key, checksum, application revision, company/venue ID, isolation policy и статус обязаны совпасть; отсутствие таблицы, чужая БД и несовпадение закрывают запуск без деталей БД в ошибке.
- `migrations/017_spaceverse_runtime_binding.sql` — отдельная ручная additive-миграция для будущей выделенной tenant-БД. Она создаёт только singleton binding table, не вставляет строки и не касается компаний, клиентов, кошельков, операций или provider data.
- `universal-server.js` проверяет привязку до запуска child, `server.js` — до `initDatabase`. Текущий manifest всегда `not_provisioned`, поэтому даже корректная подготовленная привязка заканчивается `SPACEVERSE_RUNTIME_NOT_PROVISIONED`. Legacy ПИВНИК без tenant env работает как раньше и не выполняет binding query.
- Две независимые PGlite-БД с разными manifest проверены: каждая принимает только свою привязку, перекрёстная попытка закрывается. VK static builder не получает server manifest.
- Успешная binding-проверка создаёт неизменяемый server-only context: `tenantId=companyId`, `locationId=venueId`. Контекст нельзя подделать обычным объектом. `createSpaceverseDashboardSummaryRepository` захватывает его до первого SQL и отвергает любые request-supplied tenant/location аргументы; проверены два tenant и два разных venue одной company. Адаптер пока не подключён к production, потому что tenant startup остаётся запрещён.
- `createSpaceverseTransactionPersistence` проводит тот же проверенный runtime через запись новых операций. Он принимает только `{ transaction }`; внешние `tenantId`, `locationId`, `authorizationContext` и неизвестные wrapper-поля отклоняются до SQL, а `tenant_id`/`location_id` запрещены существующим allowlist transaction payload.
- Запись одним параметризованным `INSERT ... SELECT` повторно проверяет runtime key, checksum, revision, company/venue, isolation и status в `spaceverse_runtime_binding` именно той БД, куда пишется операция. Tenant/location берутся из binding-строки, поэтому проверенный runtime нельзя соединить с БД другого tenant или другого venue. Точное повторение `request_key` возвращает исходную строку; другой payload с тем же ключом закрывается без изменения данных. После потерянного ответа повтор тем же ключом восстанавливает результат. Legacy fallback отсутствует.
- Tenant runtime теперь брендируется целиком приватным `WeakSet`, а не только вложенным context: копия/обёртка проверенного объекта не принимается write/read boundary. Новый writer не подключён к HTTP и production; он не меняет текущие staff/admin/achievement/POS маршруты и не создаёт клиентов или кошельки.
- `migrations/019_spaceverse_customer_ownership.sql` вручную добавляет явную принадлежность клиента без DML/backfill. Composite foreign key связывает `user_id` с точным `runtime_key/company_id/venue_id` из binding-таблицы и запрещает незаметную перепривязку или удаление работающего runtime.
- `createSpaceverseCustomerWalletRepository` принимает только канонический `userId` и приватно проверенный runtime. Один read-only SQL повторно проверяет runtime key, checksum, revision, company/venue, isolation и status именно в целевой БД, после чего достигает `users`/`wallets` только через ownership-строку. Unowned, deleted, merged и non-client строки возвращаются как отсутствующие; другая БД, tenant/venue, request-supplied scope, поддельный или скопированный runtime отклоняются без legacy fallback. Repository используется общим tenant auth/wallet adapter, который остаётся недостижимым до успешного startup guard.
- `createSpaceverseCustomerProvisioner` добавляет узкую write boundary только для **нового** клиента. Она принимает `{requestKey, customer}` без company/venue/runtime полей, требует UUID v4 и Telegram/VK provider ID, а scope берёт только из приватно проверенного runtime. В одной транзакции binding блокируется и повторно сверяется, затем создаются канонические `users`, `user_identities`, нулевой `wallet` и точная ownership-строка.
- Ручная additive-миграция `020_spaceverse_customer_create_requests.sql` добавляет только ledger UUID/fingerprint → созданный `user_id`, связанный composite FK с exact runtime/company/venue. В ledger нет provider ID, имени, контакта или секрета; DML/backfill и automatic startup отсутствуют. Точный replay возвращает тот же ресурс, изменённый payload отвергается, а потерянный ответ после фактического COMMIT восстанавливается повтором с тем же UUID.
- До вставки проверяются и canonical `user_identities`, и legacy `users.telegram_id`: существующий Telegram/VK ID получает явный конфликт и не становится клиентом нового tenant. Unique race допускает один ограниченный повтор, после которого тот же request восстанавливается, а чужая identity закрывается. Ошибка любого шага откатывает ledger, user, identity, wallet и ownership; детали БД не попадают наружу. Auth не содержит второго пути вставки и делегирует provisioner каждый missing-customer write; manifest остаётся `not_provisioned`, поэтому production-путь не активирован.
- Параллельно появившийся вариант отдельной таблицы клиентов/балансов после сравнения не сохранён: он дублировал существующие `users`/`wallets` и расходился с требованием переиспользовать текущие сущности. В истории ветки он остаётся видимым, итоговое дерево содержит только явную ownership-модель.
- `GET/PUT /api/admin/onboarding/drafts/:id/scope` — реальный третий шаг мастера. PUT принимает только точные ревизии сохранённых draft/application, блокирует draft транзакционно и один раз резервирует канонические ID. Для новой организации создаются `companies(active=false)` и `venues(active=false)`; для существующей компании создаётся только неактивное venue.
- Scope, company, venue и audit фиксируются одной транзакцией. Потерянный ответ безопасно повторяется с теми же ревизиями; блокировка draft и ограничения PK/UNIQUE закрывают путь к дубликату. Ошибка аудита откатывает обе канонические строки. После подготовки draft/application заморожены, чтобы сохранённый scope не расходился с исходными данными. PGlite проверяет replay/double-click, но реальная межсоединительная PostgreSQL concurrency остаётся для integration environment.
- Обычный tenant resolver требует `company.active=true AND venue.active=true`, поэтому даже SUPER_ADMIN, owner и trusted не могут открыть подготовленное venue через прямой рабочий API. `admin_company_access`, сотрудники, пароли, клиенты, кошельки, операции и provider connections не создаются и не меняются.
- UI показывает канонические company/venue ID и честный статус «Подготовлено · выключено». Несохранённые изменения блокируют подготовку; после неё формы заблокированы. Reload повторно читает scope с сервера, browser storage не используется.
- После scope тот же UI показывает шаг «Касса · Эвотор». `GET/PUT .../integrations/evotor` сохраняет только creator-scoped конфигурацию, а `POST .../verify` отдельно проверяет чтение страницы документов. Состояния различаются как `configured`, `verified`, `action_required` и `error`; наличие токена или простой HTTP 200 успехом не считается.
- Токен существует в форме только до ответа на сохранение, очищается после него и не попадает в session/local storage, URL, runtime manifest, audit или API response. PostgreSQL хранит AES-256-GCM envelope с AAD, привязанным к draft/provider/store; ключ и старые ключи ротации находятся только вне БД. API возвращает фиксированную маску.
- Проверка переиспользует `pos/evotor-client.js`: фиксированный HTTPS host, redirect-error, 15-секундный timeout, ограничение тела и shape validation. Проверяется только право чтения документов. Аккаунт/приложение Эвотора, POS binding, синхронизация чеков и публикация приложения не создаются.
- `admin-platform/server/onboarding-provisioning.ts` переиспользует тот же creator-scoped замороженный draft/application/scope и вычисленный сервером runtime manifest. Одна ledger-строка `runtime_database_binding` транзакционно выдаётся worker на 30 секунд; второй клик видит действующую lease, истёкшая lease и фиксированная ошибка безопасно повторяются.
- Целевая БД выбирается только server-side resolver по сохранённому runtime key: URL/host/credential отсутствуют в request, manifest, ledger, audit и ответе. В БД с вручную применёнными migrations 017/018 worker вставляет exact singleton binding, принимает уже точное совпадение после неопределённого ответа и никогда не перезаписывает несовпадение.
- Cross-database атомарность не симулируется: после target COMMIT metadata-финализация может быть повторена; новый worker сначала сверяет exact binding. Создание БД, автоматический запуск tenant migrations, активация company/venue/runtime и публикация не выполняются.
- `onboarding-database-registry.ts` принимает только строгую server-side карту `runtime key → SPACEVERSE_TENANT_DATABASE_URL_*`; URL хранится в отдельной защищённой env-переменной. Реестр запрещает Admin/legacy DB, одну БД для двух runtime, embedded URL, повтор credential reference и malformed key. Пулы ограничены, переиспользуются, закрываются при ротации/остановке; секреты и driver errors не выводятся.
- `GET .../provisioning/runtime-database-binding` возвращает сохранённый статус и server-authoritative `startAllowed`, `POST .../run` принимает только пустую команду. Query/body с URL, ключом или scope отклоняются; Origin/session/CSRF/rate limit и существующие scoped write-права применяются сервером. Отдельный `ADMIN_ENABLE_ONBOARDING_PROVISIONING` по умолчанию выключен. Текущий UI перечитывает ledger после открытия/reload, блокирует двойной клик и активную lease, разрешает reclaim только по `startAllowed` и не показывает DB URL/credential.

## Включение в изолированном окружении

- Additive migrations: `admin-platform/admin-migrations/004_onboarding_drafts.sql`, `005_onboarding_app_config.sql`, `006_onboarding_scope.sql`, `009_onboarding_integrations.sql`, `010_onboarding_provisioning.sql`, `012_onboarding_progress.sql` и `013_onboarding_schema_readiness.sql`. Нет запуска из `server/index.ts` и нет изменения исторических миграций. 005 применяется после 004; 006 — после обеих; 009 создаёт только зашифрованное хранилище одного provider; 010 — пустой ledger фиксированного provisioning-шагa; 012 — серверный прогресс мастера; 013 только разрешает второй фиксированный шаг в том же ledger. В них нет tenant DML, DB credentials или внешних ресурсов. Само выделение неактивных company/venue выполняет защищённый API после явного действия.
- Migrations 009 и 017–020 не входят в automatic startup allowlist. 009 только добавляет nullable tenant/location к новым transactions без backfill; 018 добавляет к будущей binding-таблице только company/venue ID и проверки формата; 019 создаёт ownership-таблицу; 020 — idempotency ledger без provider/profile данных. В них нет DML/backfill и они не меняют существующие `users`/`wallets`/`user_identities`. Применение допустимо только вручную к новой выделенной тестовой БД; в общей исторической БД ПИВНИКА этот шаг не нужен и не разрешён.
- Только после подготовки изолированной metadata-БД: `ADMIN_ENABLE_WRITES=true` и `ADMIN_ENABLE_ONBOARDING_DRAFTS=true`. Подключения требуют отдельный выключенный по умолчанию `ADMIN_ENABLE_ONBOARDING_INTEGRATIONS=true`, `ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID` и JSON-keyring `ADMIN_ONBOARDING_SECRET_KEYRING` с 32-байтовыми base64-ключами. Provisioning отдельно требует `ADMIN_ENABLE_ONBOARDING_PROVISIONING=true`, строгую карту `ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON` и по одной защищённой `SPACEVERSE_TENANT_DATABASE_URL_*` на runtime. Без таблицы, ключа или registry entry API fail-closed; остальные шаги мастера продолжают работать.
- До production-выпуска один и тот же encryption key material должен иметь три независимо защищённые копии: основная sealed-переменная сервиса, зашифрованная резервная копия в управляемом secret manager и offline break-glass копия с отдельным доступом. Они сейчас намеренно не создавались. DB/git/CI/logs не являются хранилищем; старый key ID нельзя удалять до rewrap всех строк и проверенного восстановления из backup.
- `SPACEVERSE_RUNTIME_MODE=tenant` и `SPACEVERSE_RUNTIME_MANIFEST_JSON` предназначены для будущего provisioner. Сейчас их установка намеренно не запускает приложение; до завершения tenant-aware runtime их нельзя добавлять в действующие Railway-сервисы.
- Production БД, Railway env, секреты, реальные сообщения, webhook, main и действующие приложения не изменялись.
- При откате выключить флаг; сохранённые черновики оставить. Удаление таблицы не требуется.

## Проверки этой итерации

- Registry + status/start API на exact опубликованном implementation commit `780a297d33a5d3176426112b7fdd750ebc4d1b20`, tree `3b6144efd349f52ed1377c122f8a15ebed997633`: профиль registry/provisioning/onboarding — 76/76; полный Business — 233 passed, 20 skipped; security — 160/160; typecheck и полный build — success; Business audit — 0. Пять registry-тестов проверяют строгую схему, отсутствие embedded URL, безопасную ротацию/закрытие пула, запрет Admin/legacy DB и запрет одной target DB для двух runtime. HTTP проверяет отдельный feature gate, status/reopen, отсутствие ledger до валидного старта, `action_required` без регистрации, повтор после регистрации до exact binding, creator/scoped доступ, другой SUPER_ADMIN 404, прямые URL/query/body 400, session/Origin/CSRF и отсутствие секретов в response/audit.
- В чистом detached-worktree materialize выполнен дважды с одинаковым SHA256 diff `ae50df990f6ef99e163a0ad5c9a965e24ab645ccf2ff59a498202794ecf69a37`; materialized root — 581/581, `npm run check`, patch-chain audit и оба root audit — success/0. Внешние `ADMIN_INTEGRATION_TEST_DATABASE_URL`/`DATABASE_URL` отсутствуют, поэтому PostgreSQL integration suite честно пропустил 20/20; PGlite не считается независимой PostgreSQL concurrency.
- Локальный Playwright не запустил сценарии: отсутствует Chromium headless shell v1193. Код UI в этом серверном шаге не менялся; последний функциональный base `94d49e1` имеет зелёный GitHub browser run #46. Exact CI опубликованного implementation/docs HEAD проверяется после публикации. Lint общего дерева остановился на `no-control-regex` в пришедшем base-файле `onboarding-invitations.ts:209`; `git blame` относит строку к `94d49e1`. Чужой пересекающийся файл намеренно не изменялся; остальные 12 сообщений — прежние Fast Refresh warnings.
- Provisioning ledger на локальном implementation commit `3727d00`: профильные проверки — 6/6, объединённый onboarding HTTP/SQL профиль — 68/68; полный Business — 219 passed, 20 skipped только без внешнего PostgreSQL URL; security — 152/152; typecheck, API build, полный build и lint — успешно (0 ошибок, 12 прежних Fast Refresh warnings); Business audit — 0. В чистом detached-worktree materialize выполнен дважды с одинаковым SHA256 diff `ae50df990f6ef99e163a0ad5c9a965e24ab645ccf2ff59a498202794ecf69a37`; materialized root `node --test --test-concurrency=2` — 581/581, `npm run check`, patch-chain audit и оба root audit — успешно/0. Проверены exact binding, reopen/replay, unexpired double-click lease, expired lease reclaim, потерянное подтверждение после target COMMIT, чужая binding без перезаписи, отсутствующие schema/registry, creator/SUPER_ADMIN scope и два tenant/два venue одной company в отдельных PGlite-БД. Внешний PostgreSQL URL отсутствует: PGlite не выдаётся за независимую межсоединительную concurrency. UI не менялся, поэтому новый browser-сценарий в этом серверном шаге не добавлялся.
- Объединённый auth/provisioning/invite кандидат на exact implementation commit `314033e81e6a658dc772e3a8db46ba36878ff6c9`, tree `06e7b632f211b9870ac91b068c7e21dc8c3a9d9c`: профильные auth/provisioning проверки — 15/15; onboarding HTTP/SQL — 54/54. В чистом detached-worktree `npm run materialize` выполнен дважды с одинаковым SHA256 diff `ae50df990f6ef99e163a0ad5c9a965e24ab645ccf2ff59a498202794ecf69a37`; с материализованными файлами root `node --test --test-concurrency=2` — 581/581, `npm run check` и patch-chain audit — успешно. Business — 205 passed, 20 skipped только без внешнего PostgreSQL URL; security — 138/138; typecheck и полный build — успешно; lint — 0 ошибок и 12 прежних Fast Refresh warnings; оба `npm audit` — 0. Playwright сначала не запустил ни одного сценария из-за отсутствующего Chromium v1193; после установки точной тестовой версии повтор прошёл 4/4 desktop/mobile. Снимки просмотрены, горизонтального overflow нет. Текущая объединённая версия проверена на PGlite/HTTP, но не выдаётся за независимую PostgreSQL concurrency или реальную Telegram/VK авторизацию.
- Объединённый кандидат после свежего main и пересекавшегося запуска: `c10835893a71d8e1b2cdc6f980561b8d4947fb44`, tree `aaf5b85fe4da2c003d6fccd59bfa32fa292bd1d4`. Конкурентная ветка сохранена в истории, дублирующая customer/balance-модель удалена, полезный preflight fix оставлен. Двойной materialize дал одинаковый SHA256 diff `2dd57cd01ca18100560d959d5d67eec11053b05ae7c03a718d92022221da6250`; root — 566/566 без skipped, `npm run check` и audit — успешно/0. Business — 191 passed, 20 skipped только без внешнего PostgreSQL URL; security — 124/124; typecheck/build — успешно; lint — 0 errors и 12 прежних Fast Refresh warnings; audit — 0. Playwright — 4/4 desktop/mobile после установки точного Chromium v1193; снимки просмотрены, формы и данные не выходят за viewport. Первичная ошибка E2E была только отсутствием browser executable и не запускала сценарии; повтор после установки прошёл полностью.
- Tenant customer/wallet ownership read boundary на exact implementation commit `f8e958d67771ecb312424e24b6cb9d31f7fae549`, tree `6321c1d01d3de04cd337d23854ae5aae80c27b7c`: профильный новый suite — 5/5, объединённые dashboard/runtime/transaction/ownership проверки — 28/28; полный root после двукратного materialize — 561/561 без skipped; `npm run check` — успешно; одинаковый materialize SHA256 diff `e270822fee14943bba6f4fa9aaaa6bcb17071cdce1bcd021f8dbf54a14af4618`; оба audit — 0. Business — 191 passed, 20 skipped только из-за отсутствия безопасного внешнего PostgreSQL URL; security — 124/124; typecheck/build — успешно; lint — 0 errors и 12 прежних Fast Refresh warnings; Playwright — 4/4 desktop/mobile, снимки просмотрены, горизонтального overflow нет. Проверены additive/idempotent migration без backfill, composite binding, owned против исторической строки, два tenant и два venue одной company, cross-database denial, request scope/forged runtime до SQL и очистка ошибок. PGlite не выдаётся за независимую PostgreSQL concurrency.
- Tenant transaction boundary на exact implementation commit `ea4fc14a2f9dc3ae0b5d948ded849427ce2c46a0`, tree `c847ba8e7a233d2f13e396d2f2492973a46d862d`: профильные persistence/runtime/migration проверки — 86/86; полный root после двукратного materialize — 556/556; `npm run check` — успешно; одинаковый materialize SHA256 diff `e270822fee14943bba6f4fa9aaaa6bcb17071cdce1bcd021f8dbf54a14af4618`; оба audit — 0. Полный Business — 191 passed, 20 skipped; security — 124/124; typecheck/build — успешно; lint — 0 errors и 12 прежних Fast Refresh warnings; Playwright — 4/4 desktop/mobile, снимки просмотрены, горизонтального overflow нет. Проверены точный retry, потерянный ответ после фактической записи, конфликтующий replay, поддельный/скопированный runtime, request-supplied scope до SQL, чужая tenant-БД, два venue одной company и отсутствие legacy fallback. PGlite исполняет настоящий PostgreSQL SQL, но не выдаётся за независимую межсоединительную concurrency; внешний тестовый PostgreSQL URL отсутствует.
- Runtime scope/context на exact published implementation commit `e0a23879b1b4b70fc1a1b716bd8fb8da19258c12`, tree `d01e7a4d22c6eb5bf65fc8af474ee05d7e5ad2e8`: manifest/repository suite — 18/18; onboarding HTTP/SQL — 40/40; полный Business — 191 passed, 20 skipped; security — 124/124; typecheck, full build и lint — успешно (12 существующих Fast Refresh warning, 0 errors); Playwright — 4/4 desktop/mobile, снимки просмотрены. Проверены manifest только после scope, серверные canonical ID, tamper/unknown-field denial, две отдельные tenant-БД, два venue одной company, cross-binding, поддельный context и request-supplied scope до SQL. Root в отдельном worktree: materialize дважды с одинаковым SHA256 diff `a8cf026d34d7acddab940bcde5a0581df8ab2864d772656df10024960c331472`; `node --test` — 551/551; `npm run check`; оба audit — 0. Внешний PostgreSQL URL не настроен, поэтому 20 integration-проверок skipped; PGlite не выдаётся за независимую concurrency.
- Scope-шаг на exact published implementation commit `aa32b7384f1789e69df7b48135ffa7ff0c940fbf`, tree `3da80f5800ed26e2c8246e1b8c3d261937e00b81`: onboarding HTTP/SQL suite — 40/40; полный Business suite — 191 passed, 20 skipped; security — 124/124; typecheck, build и lint — успешно (только 12 существующих Fast Refresh warning, 0 errors); настоящий Playwright UI — 4/4 desktop/mobile. Проверены создание новой неактивной организации, два разных неактивных заведения одной существующей компании, replay/double-click, точные ревизии, Origin/CSRF/session, запрет owner/trusted/другого SUPER_ADMIN, прямой API 404, rollback при ошибке audit и отсутствие migration 006. Скриншоты desktop/mobile просмотрены, горизонтального overflow нет.
- Root: полный materialize дважды дал одинаковый SHA256 diff `a8cf026d34d7acddab940bcde5a0581df8ab2864d772656df10024960c331472`; с материализованными файлами `node --test` — 548/548, `npm run check` — успешно. Генерируемый diff в commit не включён. Root и Business `npm audit` — 0 уязвимостей. PostgreSQL integration suite пропущен из-за отсутствия безопасного `ADMIN_INTEGRATION_TEST_DATABASE_URL`; PGlite не выдаётся за проверку межсоединительной concurrency.

- Root на exact implementation commit `512425392d385ee91a558d5c69e38de39d000b88`, tree `e9787e6f18e12adc0484b15710092d31f4871a6d`: materialize дважды, одинаковый SHA256 diff `a8cf026d34d7acddab940bcde5a0581df8ab2864d772656df10024960c331472`; `node --test` — 548/548, без skipped; `npm run check` — успешно. Результаты materialize в commit не включены.
- Business: `npm test -- --maxWorkers=1` — 184 passed, 20 skipped. Skipped — существующие тесты с внешним PostgreSQL, а не новые тесты мастера.
- Файл onboarding содержит 33 HTTP/SQL проверки; новый runtime suite — 8/8; общий `test:security` — 117/117. Дополнительно проверены checksum/strict schema, legacy без DB lookup, точная binding-запись, две независимые tenant-БД, cross-binding denial, отсутствие автозапуска migration 017, порядок guard в обоих runtime и отсутствие server manifest в VK build.
- Root и Business `npm audit` — 0 уязвимостей; установлены точные lockfile-зависимости через npm ci.
- `npm run test:security -- --maxWorkers=1` — 117/117.
- Typecheck, API build и полный build — успешно. `npm run test:e2e:onboarding` — 4/4 на desktop/mobile: настоящий UI → HTTP → SQL, reload/edit, double click, потерянный ответ после настоящего COMMIT и восстановление того же черновика, запрет владельцу заведения. PostgreSQL integration suite корректно пропущен целиком (20 тестов): внешний test URL в этом окружении не настроен.
- Проверены снимки `admin-platform/artifacts/onboarding-desktop.png` и `onboarding-mobile.png`; горизонтального overflow нет. Fixture-процесс ограничен loopback, оба пула используют изолированную БД.
- PGlite исполняет настоящий SQL, но не доказывает независимую PostgreSQL concurrency. Браузерная проверка использует настоящий собранный App и router, синтетические учётные записи и изолированную БД; это не production-авторизация и не проверка внешнего провайдера.
- Railway повторно проверен только на чтение 2026-10-13: production-сервис `admin-pilot` live на ветке main, staged-изменений нет; последний успешный deployment — `3d3d1935f6885f6dca49ceb59d55e7af9118096a` (создан 2026-10-13 03:57 UTC). `ADMIN_ENABLE_ONBOARDING_DRAFTS` и `SPACEVERSE_RUNTIME_*` среди имён переменных отсутствуют. Значения переменных были скрыты и не читались. Этот PR в production не развёрнут.

## Следующий безопасный шаг

После зелёного CI добавить следующий ограниченный шаг provisioning: собрать и проверить конфигурацию tenant-runtime из существующего артефакта после успешной schema readiness, но не запускать сервис, не публиковать приложение и не менять Railway. Шаг должен сохранить тот же ledger/retry, сверять exact manifest/checksum и выдавать только проверяемый server-side результат. Telegram/VK оставить «нужно действие» до отдельного официального OAuth/авторизации владельца.


## Продолжение владельческого сценария — 2026-10-13

Лично начатая в этой сессии работа: auth/wallet adapters поверх существующей migration 019. Предыдущий мастер, runtime binding и ownership read repository уже были в PR #273 на HEAD 530df108d5ca71b4d08d267abc4e6ded5d85de9a; они не выдаются за новую реализацию этой сессии. Работа ведётся в существующем cloud checkout /workspace/pivnik-bonus-app, ветка spaceverse/venue-onboarding, без нового worktree. Main совпадает с базой PR: 3d3d1935f6885f6dca49ceb59d55e7af9118096a.

Фактическое имя канонической таблицы migration 019 — spaceverse_customer_ownership, а не spaceverse_tenant_customers. Вторая модель tenant не создаётся.

До правок выполнены npm run materialize дважды. Первый чистый запуск меняет семь tracked файлов: achievements.js, app.js, index.html, red-cosmos-v2.js, scripts/v22-data-audit-and-repair.mjs, server.js, universal-server.js (365 добавленных / 78 удалённых строк). Второй запуск даёт тот же побайтовый diff. Это исходное поведение patch-chain, не исправление текущей задачи; сгенерированный diff сохранён вне checkout и не включается в feature commit.

SHA256 исходного materialize diff: 2dd57cd01ca18100560d959d5d67eec11053b05ae7c03a718d92022221da6250.

/mnt/project-files/owner-panel/progress.md сейчас недоступен: /mnt смонтирован read-only, даже после предоставления sandbox write permission. Журнал ведётся здесь; перенос копии в требуемый путь остаётся внешним ограничением среды. GitHub REST/GraphQL API отклонены прокси (Forbidden); описание PR прочитано один раз через разрешённую публичную страницу github.com. Git read и push --dry-run текущей ветки доступны.

План этой сессии: (1) атомарный tenant-local auth/create + wallet adapters и серверные проверки изоляции; (2) приглашения и возобновляемые шаги мастера; (3) provider/proxy boundary и честная проверка связи; (4) владельческий список, мобильные E2E и runbook. Production, merge/deploy, Railway, CI configuration, реальные устройства и удаление данных не разрешены и не выполняются.

### Шаг 1 — auth и wallet adapters

Лично реализованы spaceverse-customer-auth.js, общий routes/spaceverse-customer.js, manual additive migration 020 и mounts в обоих runtime. Создание нового клиента/identity/кошелька/ownership/receipt атомарно; исторические identity не присваиваются. Подписанные сессии привязаны к точному runtime/company/venue/checksum; scope из body/query/headers отвергается. Wallet balance=0 возвращается как реальные данные; отсутствующий кошелёк возвращает 503. Apple/Google issuer остаются not_configured, весь runtime остаётся not_provisioned. Guard старта не ослаблен.

Лично выполненные команды, все exit 0:

- npm run materialize ×2; cmp materialize-first.diff materialize-second.diff — побайтовая идемпотентность. Исходный побочный diff patch-chain сохранён вне репозитория и не включён в commit.
- node --test --test-concurrency=2 — 573/573, 0 skipped. Семь новых тестов включают реальные Express/gateway HTTP → signed auth → SQL → wallet, два tenant, две точки одной компании, scope substitution, stale/changed sessions, rollback и lost-COMMIT replay.
- npm run check; npm run audit:runtime-patches — passed.
- npm audit; npm audit --omit=dev --audit-level=high; npm audit --prefix admin-platform — каждый found 0 vulnerabilities.
- Business npm run typecheck; npm test -- --maxWorkers=2 — 191 passed, 20 skipped; npm run build — passed. Старый integration suite не запускался без выделенного test URL: он сбрасывает public schema; существующие базы/данные не сбрасывались.
- node /tmp/spaceverse-auth-postgres-proof.mjs — PASS на настоящем PostgreSQL 17, независимые соединения: 8 одновременных входов создали одну ownership/user/wallet, точные повторы не дублируют, конфликт payload закрывается, чужие tenant/venue/БД закрываются. Три новых синтетических proof DB сохранены; ничего не удалено.
- npm exec --prefix admin-platform --no -- playwright test -c /tmp/spaceverse-onboarding-playwright.config.mjs — 4/4 desktop/mobile. Использованы существующие UI/HTTP/SQL E2E; ключи/учётные записи синтетические, Chromium из /usr/bin/chromium.

Непроверено: production provisioning, настоящие Telegram/VK credentials/providers и реальные устройства. Это отдельные запрещённые внешние действия; not_provisioned не заменяется успехом. P3 вне scope: существующий onboarding E2E fixture пишет ENOENT для favicon.ico; четыре теста успешны, попутная правка не делалась.

### Шаг 2 — одноразовая ссылка-приглашение владельцу (2026-10-13, коммит 6a40bb7)

Владелец явно выбрал канал доставки «ссылка» (не email/Telegram) через
decision-карточку. Реализована только выдача/отзыв/аудит самого
артефакта-ссылки: `admin-migrations/007_onboarding_invites.sql`
(`admin_onboarding_invites`: hash токена, expires_at, pending/revoked),
create/list/revoke в `venue-onboarding.ts` и роуты в `router.ts`, UI-блок в
`VenueOnboarding.tsx`. Сырой токен возвращается ровно один раз, не хранится
и не логируется. Создание новой ссылки автоматически отзывает предыдущую
pending-ссылку того же черновика. Требует подготовленной области (scope);
без неё — 409, без миграции — 503 (fail-closed).

Осознанно не сделано: редемпция ссылки в реальный доступ VENUE_ADMIN/owner.
Это меняет права и требует отдельного явного разрешения владельца (как и
прочие изменения прав/API/бонусов) — не угадывается и не берётся без ответа.

Проверено: materialize ×2 идемпотентно (изменений в patch-chain нет — весь
diff в `admin-platform/`), корневой `node --test` 573/573 без изменений,
`npm run check`, `npm audit --omit=dev --audit-level=high` 0, Business
`tsc -b` чисто, Business `vitest run` 199 passed/20 skipped (+8 новых тестов
на инвайты), Business `npm run build` успешно, `npm run lint` 0 ошибок (12
прежних warnings), Business `npm audit` 0. Попутно починен скрытый баг
тестового фикстура (`companies_id_seq`/`venues_id_seq` не сдвигались после
ручных INSERT с explicit id, из-за чего новые тесты рано или поздно
коллизировали с id=10/20/30) — только тестовое окружение, не миграции.

Следующий безопасный шаг: ждёт владельца — разрешение на редемпцию ссылки
(создание реального доступа владельцу заведения). Без этого ответа следующий
шаг без его решения — п. в) очереди мастера: мелкие улучшения удобства самой
Панели Владельца без изменения расчётов/API.

### Шаг 3 — редемпция ссылки в реальный доступ (2026-10-13, коммит 1fa504b)

Владелец ответил «да» в треде — явное отдельное разрешение (не угадывание)
на то самое, о чём спросил шаг 2: превратить ссылку в реальный доступ.

Реализовано: `admin-migrations/008_onboarding_invite_claims.sql`
(`claimed_admin_id`, `claimed_at`, статус `claimed`). Два публичных
(без сессии) эндпоинта в `venue-onboarding.ts`/`router.ts`, добавленных
ДО загрузки сессии: превью приглашения (только имя заведения/организации,
никаких ПД) и claim — одной транзакцией создаёт новую учётную запись
`VENUE_ADMIN`, выдаёт ей owner-доступ к подготовленной компании, помечает
приглашение `claimed`, пишет аудит и сразу подписывает в сессию. Email,
совпадающий с существующей учётной записью, отклоняется (409,
`ONBOARDING_ACCOUNT_EXISTS`) — доступ никогда не прикрепляется к чужому
аккаунту. Уже использованный/отозванный токен — 404. Оба публичных пути
всё равно проходят `enforceOrigin` и rate-limit, как и прочие
state-changing пути. Публичная страница `/invite/:token` — новый
`InviteClaim.tsx`, подключён без клиентского роутера (regex по пути в
`main.tsx`), чтобы не завязывать публичную страницу на сессионный бутстрап
`App.tsx`. UI панели приглашений теперь показывает полную ссылку (не
только «только что созданный» токен) и статус
Активна/Использована/Отозвана.

Попутно нашёл и починил тот же класс бага фикстура, что в шаге 2, теперь
для `admin_accounts_id_seq`: явные id 1/2/11/12 в `onboarding-fixture.ts`
не сдвигали автоинкремент, из-за чего первый тест, создающий аккаунт через
claim, получал ложный `409 ONBOARDING_ACCOUNT_EXISTS` (на самом деле —
PK-коллизия). Починка только тестового окружения. Также добавил
тестовый-только сброс rate-limit бакетов между тестами
(`__resetRateLimitBucketsForTests` в `security.ts`, не используется
production-кодом) — новые тесты на claim делили общий лимит с остальными
тестами файла и роняли несвязанный более поздний тест по 429; в суите нет
тестов самого rate-limiting, так что сброс после каждого теста безопасен.

Проверено: Business `tsc -b` чисто, Business `vitest run` 205 passed/20
skipped (+6 новых тестов на claim), Business `npm run build` успешно,
`npm run lint` 0 ошибок (те же 12 прежних warnings), Business `npm audit`
0. Корень: `npm run materialize` ×2 — идемпотентно, побочные файлы
runtime-патчей не коммитились; `npm run check` чисто; `node --test`
573/573; `npm audit --omit=dev --audit-level=high` 0.

Правило 6 (свежесть origin): `git fetch` перед началом и непосредственно
перед коммитом/пушем — оба раза HEAD совпадал с
`origin/spaceverse/venue-onboarding` (`3de8c68`), посторонних коммитов не
было.

Следующий безопасный шаг без дальнейшего решения владельца: п. в) очереди
мастера — мелкие улучшения удобства самой Панели Владельца без изменения
расчётов/API/прав.

### Шаг 4 — объединение конкурентных auth/provisioning реализаций (2026-10-13)

Перед изменением повторно получен `origin/spaceverse/venue-onboarding`:
удалённый HEAD `1ead0bf8eb1230944d78fc735fff7429ba1e0d23` уже содержал auth/wallet
HTTP, одноразовую ссылку владельцу, claim и кнопку копирования. Локальная
ветка содержала отдельно проверенный атомарный provisioner. Истории сведены
обычным merge без force-push; приглашения и claim сохранены.

Конкурентный auth первоначально имел второй inline-путь создания
`users`/`user_identities`/`wallets`/ownership и отдельную migration 020,
которая хранила provider ID. Итоговое дерево оставляет одну migration
`020_spaceverse_customer_create_requests.sql` и одну write boundary
`customer-provisioning.js`. `spaceverse-customer-auth.js` теперь только
проверяет подписанную identity, exact runtime binding и ownership; при
отсутствии профиля вызывает provisioner. Если конкурентный create уже
победил, свежий exact-owned lookup разрешает вход; historical/unowned
identity остаётся 401 и не присваивается. Legacy `users.telegram_id` без
строки `user_identities` тоже закрыт. Потерянный ответ после COMMIT
восстанавливается повтором без дубля. Фото принимается только как HTTPS URL
без credentials; оно не попадает в idempotency ledger в открытом виде.

Оба guest entrypoint используют один HTTP adapter и остаются за startup
guard. Tenant manifest по-прежнему `not_provisioned`; новая организация,
пользователь, база, webhook, бот или касса в production не создавались.
Права/пароли существующих владельца и trusted-директора не менялись. В
Railway выполнена только read-only проверка: активен прежний main deployment,
staged changes нет, onboarding/runtime env-флаги отсутствуют.

### Шаг 5 — защищённая настройка и проверка Эвотора (2026-10-13)

В том же мастере после подготовленного scope добавлен один узкий provider-срез,
переиспользующий `pos/evotor-client.js`. Ручная additive admin migration 009
хранит ID магазина, AES-256-GCM envelope и безопасный request fingerprint;
ключ остаётся вне БД. `GET` возвращает только фиксированную маску, `PUT`
транзакционно сохраняет/заменяет настройку с UUID replay-защитой,
`POST .../verify` читает одну страницу документов через фиксированный HTTPS host,
15-секундный timeout, запрет redirect и проверку формы ответа. Статусы честно
разделены на configured/verified/action_required/error. Аккаунт Эвотора,
установка приложения, POS binding, импорт чеков, runtime и публикация не
создаются. Функция имеет отдельный выключенный по умолчанию флаг и fail-closed
keyring с active/previous key ID; проверочная запись rewrap-ит секрет активным
ключом. Токен очищается из UI после сохранения и отсутствует в browser storage,
URL, audit, runtime manifest и ответах API.

Проверено на локальном implementation commit
`469f8b7b6d455251c9d73811c90ddcfaa25cdfac`; его tree
`3cdd8cce36d4b2d76458d98e1485674eb0c0655c` побайтово совпадает с
опубликованным commit `fbf69646ddb7518df6d043bc36cf50b058610970`:

- в чистом detached-worktree `npm run materialize` выполнен дважды; оба раза
  получен одинаковый SHA256 diff
  `ae50df990f6ef99e163a0ad5c9a965e24ab645ccf2ff59a498202794ecf69a37`
  по ожидаемым семи runtime-файлам; generated diff не включён в commit;
- materialized root: `node --test --test-concurrency=2`, `npm run check`,
  `npm run audit:runtime-patches` — exit 0; `npm audit` — 0 уязвимостей;
- Business: 213 passed, 20 skipped только без внешнего PostgreSQL URL;
  security 146/146; профиль onboarding 62/62; typecheck и полный build — exit 0;
  lint — 0 ошибок и 12 существующих Fast Refresh warnings; audit — 0;
- проверены exact replay/conflict, creator scope, owner/trusted/другой
  SUPER_ADMIN denial, CSRF/Origin/session, ciphertext вместо plaintext,
  tamper/missing-key fail-closed, key rotation/retirement, валидный ответ,
  403 и malformed HTTP 200. Provider-ответы в тестах синтетические; живой токен
  и реальный Эвотор не вызывались;
- один полный Business-run под одновременной нагрузкой получил timeout
  существующего 5-секундного PGlite-теста `evotor-read`; изолированный полный
  повтор прошёл 213/213 исполняемых тестов. Это не выдаётся за независимую
  PostgreSQL concurrency;
- локальный Playwright не запустил сценарии из-за отсутствующего Chromium
  headless shell v1193. Commit `f917e9973dded51aa8fc7229fdfa5c20196f2410`
  добавил существующий onboarding desktop/mobile suite в browser CI с точным
  Chromium. Первый run #42 нашёл настоящий accessibility-дефект: поле токена
  не имело отдельного exact accessible name. Commit
  `066d52dc3e699ac18d93f6ea7da88e4e7280be14` добавил явный `aria-label`;
  typecheck/build, lint (0 ошибок) и профиль 62/62 прошли локально. Повторный
  browser run #43 прошёл: cash 6/6 и onboarding 4/4 на desktop/mobile;
- все пять workflow exact functional HEAD `066d52dc3e699ac18d93f6ea7da88e4e7280be14`
  завершились success: public startup #350, Evotor draft #22, browser #43,
  release gate #1940 и VK parity #765. Review threads/reviews отсутствовали,
  PR оставался mergeable draft.

Production/main, Railway variables, реальные секреты, webhook, бот и касса не
изменялись. Для будущего выпуска требуется заранее создать и проверить три
независимо защищённые копии key material; в этой итерации они намеренно не
создавались.

### Шаг 6 — возобновляемая фиксация runtime binding (2026-10-14)

Добавлена ручная additive admin migration 010 и серверный
`onboarding-provisioning.ts`. Ledger привязан к точным draft, runtime key,
manifest checksum/revision и canonical company/venue. Claim выполняется в
metadata-транзакции и выдаёт 30-секундную lease: активная lease закрывает
двойной клик, истёкшая lease и безопасно зафиксированная ошибка допускают новый
attempt. Worker повторно получает manifest только из creator-owned
draft/application/scope; клиент не может передать tenant, venue, manifest или
адрес БД.

Первое действие работает с заранее созданной выделенной БД через server-side
resolver по runtime key. Оно требует вручную применённых migrations 017/018,
создаёт только exact singleton `spaceverse_runtime_binding`, принимает exact
существующую строку после неопределённого ответа и не изменяет несовпадающую
строку. Target COMMIT и metadata completion намеренно не выдаются за одну
распределённую транзакцию: retry сначала сверяет binding и затем завершает
ledger. Fixed error codes различают отсутствующий registry, отсутствующую
schema, конфликт binding, недоступность БД и неопределённое подтверждение;
сырой текст драйвера, URL и credentials не сохраняются и не возвращаются.

Опубликованный implementation commit:
`9c0e9de771b1dc5d7f149b305de7fa02a0148566`, tree
`ddd50face39502f7fb10cce95e526993ad14b4e2`, parent — последний проверенный
published HEAD `2e12115f2324639092f3635df0ea859c5393e61e`. Локальный проверенный эквивалент
того же tree — `3727d0068258b67aaa53183a0e68ebac35738632`.

Фактические проверки:

- новый suite 6/6; вместе с onboarding HTTP/SQL — 68/68;
- Business 219 passed, 20 skipped только без внешнего PostgreSQL URL;
  security 152/152; typecheck, API/full build и lint — success, 0 ошибок и 12
  прежних Fast Refresh warnings; audit — 0;
- в чистом detached-worktree materialize ×2 дал один SHA256 diff
  `ae50df990f6ef99e163a0ad5c9a965e24ab645ccf2ff59a498202794ecf69a37`;
  materialized root 581/581, check и patch-chain audit — success, оба audit — 0;
- проверены exact/reopen/replay, один unexpired claim при двойном запуске,
  reclaim истёкшей lease, восстановление после target COMMIT без metadata
  подтверждения, запрет перезаписи чужой binding, отсутствующие schema/registry,
  owner/другой SUPER_ADMIN denial и два tenant/два venue одной company в двух
  отдельных PGlite-БД.

PGlite не считается доказательством независимой PostgreSQL concurrency;
безопасный внешний test URL отсутствует. UI в этом серверном шаге не менялся.
Движок намеренно не смонтирован в HTTP/UI: сначала нужен защищённый registry
credential references. База, runtime, provider account, webhook и POS не
создавались; company/venue не активировались; production/main/Railway не
изменялись.
Шаг 1 опубликован в существующей ветке Draft PR #273: commit 77783e6. Origin branch проверена через git ls-remote; merge/deploy не выполнялись.

### Шаг 7 — защищённый registry и HTTP status/start (2026-10-14)

Опубликован implementation commit
`780a297d33a5d3176426112b7fdd750ebc4d1b20`, tree
`3b6144efd349f52ed1377c122f8a15ebed997633`, поверх сохранённого чужого
design-note `7b38a73468f192b91b376e9043f70eac32e6eaeb`. Реализация добавляет только
server-side registry ссылок на секретные env и status/start API уже существующего
шага `runtime_database_binding`; параллельный provisioner или tenant model не
созданы.

Решение: runtime key берётся только из frozen manifest, registry хранит лишь имя
защищённой env-переменной, а credential читается отдельно на сервере. Exact
Admin/legacy DB identity и повтор target identity запрещены. Ротация значения
пересоздаёт ограниченный пул, shutdown его закрывает. GET возвращает ledger,
POST принимает строго `{}`; URL, secret, tenant/company/venue из браузера не
принимаются. Отсутствующая регистрация — честный `action_required`, не
«подключено». Scoped owner/manager policy из пришедшей реализации приглашений
сохранена; viewer, чужой scope и другой SUPER_ADMIN не получают данные.

Фактические проверки общего дерева перечислены в разделе выше. Новый UI не
добавлялся: локальный Playwright не стартовал без Chromium v1193, а exact CI
проверяется после публикации docs HEAD. Внешней PostgreSQL test DB нет; 20
integration tests пропущены, PGlite не выдаётся за concurrency proof. Побочный
lint-дефект пришедшего `onboarding-invitations.ts` сохранён отдельно и не
исправлялся конкурентно. Production/main/Railway, реальные БД, секреты,
webhook, боты, касса, company/venue active flags и runtime publication не
менялись.

### Текущая итерация — scoped приглашение ведёт в сохранённый мастер

Лично добавлены ручная additive Admin migration 011 (расширяет существующую таблицу 007/008), server-owned приглашения на canonical company/venue и отзывной ledger прав (без второй tenant модели). Выдача и точный повтор, срок 1–168 часов, одноразовость, принятие, отзыв и audit подтверждаются сервером. Токен только в явном ответе владельцу/fragment ссылки, в БД только hash; audit/browser storage не получают token/password. Существующая учётная запись требует входа и не получает новый пароль. Новый Admin account, принятие, scope access и audit атомарны. Принявший может повторить запрос при потере ответа; чужой повтор закрыт.

Owner/manager/viewer права распространяются только на приглашённую организацию или точку; per-draft permissions вычисляются сервером. Права используемой записи блокируются до COMMIT, отзыв закрывает последующие запросы. Creator shortcut не сохраняет доступ после отзыва, даже при наличии приглашения на другую компанию. Для новой выключенной организации используется существующий canonical scope, а не nullable company_id исходного draft. Manager продолжает сохранённый мастер после reload; viewer не может писать. Owner может вновь открыть выданную активную ссылку после reload или отозвать уже принятые права. Панель нового управляющего честно показывает «Заведение не запущено».

Проверки исходного локального commit 02b98e1 до обнаружения новых remote commits (они не считаются проверкой общего дерева); все exit 0, логи /tmp/spaceverse-invitation-gate:

- npm run materialize ×2; cmp materialize-first.diff materialize-second.diff — идентичны. Тот же исходный diff в семи root файлах (включая server.js, universal-server.js, app.js; 365/78) сохранён вне checkout и исключён из commit, patch-chain не исправлялась.
- node --test --test-concurrency=2 — 573 passed, 0 skipped; npm run check; npm run audit:runtime-patches — passed.
- npm audit; npm audit --omit=dev --audit-level=high; npm audit --prefix admin-platform — по 0 vulnerabilities.
- Business npm run typecheck; npm test -- --maxWorkers=2 — 197 passed, 20 skipped; npm run build — passed. 20 прежних integration tests требуют URL и сбрасывают public schema; существующие БД не сбрасывались.
- npm test -- --maxWorkers=1 server/tests/onboarding-invitations.spec.ts server/tests/venue-onboarding.spec.ts — 46/46; реальные signed Admin HTTP и SQL, чужие scopes, viewer, CSRF/Origin, expiry/revoke, rollback audit, новая pending организация и две точки одной компании.
- node /tmp/spaceverse-invitations-postgres-proof.mjs — PASS, настоящий PostgreSQL: 6 одновременных HTTP повторов выдали одну ссылку; 2 разных получателя одновременно приняли её, только один получил права; повтор тем же actor и отзыв подтверждены. Новая синтетическая БД сохранена, удаления данных не было.
- npm exec --no -- playwright test -c /tmp/spaceverse-invitations-playwright.config.mjs — 2/2 desktop/mobile: owner link → новый manager → настоящий wizard → reload → сохранённое приложение → inactive scope → отзыв → 403. Chromium /usr/bin/chromium, SQL и подписанные сессии, без mocked frontend API.
- npm exec --no -- playwright test -c /tmp/spaceverse-onboarding-playwright.config.mjs — 4/4 прежних E2E с выключенным invitation flag; backward compatibility сохранена.

Runbook ops/SPACEVERSE-VENUE-ONBOARDING.md и MODULE-MAP обновлены в том же PR. Остаётся: terminal/proxy v2, общие статусы шагов и modules, deployment UI, unified owner statuses и реальная внешняя связь. Пришедшее с remote чтение документов Эвотора не подтверждает терминал. Флаг приглашений по умолчанию выключен; production миграции/env/данные/устройства не менялись. На подготовленной точке по-прежнему not_provisioned, published=false; это не готовое активное заведение. Требуемый /mnt/project-files/owner-panel/progress.md остаётся недоступен из-за read-only mount, журнал хранится в этом файле.

При первом push remote ушёл с 77783e6 на 7f596f6. Свои изменения сохранены в локальной recovery branch, перенесены rebase без force-push; чужие auth/provisioner, Evotor, provisioning и документация сохранены. Изменение CI f917e99 пришло с remote и не является моей работой. Новая migration перенумерована в 011 и расширяет admin_onboarding_invites вместо второй таблицы. Scoped flow выключает старый claim/issuance при новом flag, старые строки/права не удаляются. Проверки общего дерева и публикация ещё выполняются.

Проверки сведённого дерева поверх remote 7f596f6, лично выполнены, все exit 0; логи /tmp/spaceverse-invitations-merged-gate:

- materialize ×2 и cmp diff — одинаковый исходный побочный diff семи файлов, 365/78; generated файлы восстановлены из сохранённых canonical копий, diff не включён в feature commit;
- node --test --test-concurrency=2 — 581/581, 0 skipped; npm run check; npm run audit:runtime-patches — passed;
- npm audit; npm audit --omit=dev --audit-level=high; npm audit --prefix admin-platform — 0 vulnerabilities каждый;
- Business npm run typecheck; npm test -- --maxWorkers=2 — 225 passed, 20 прежних PostgreSQL integration tests skipped по указанной выше причине; npm run build — passed;
- профиль invitations/onboarding/provisioning — 74/74; viewer не может сохранять/проверять Evotor, старый claim закрыт при scoped flag;
- node /tmp/spaceverse-invitations-merged-postgres-proof.mjs — PASS с независимыми PostgreSQL соединениями на актуальной migration 011: 6 параллельных выдач одной команды, 2 получателя/1 winner, signed retry, revoke; новая synthetic DB сохранена;
- Playwright invitations — 2/2 desktop/mobile; прежний onboarding с Evotor read fixture — 4/4 desktop/mobile. API/SQL настоящие, provider-ответ синтетический. Никаких production/provider/device действий.

Новая модель приглашений использует существующие admin_onboarding_invites (007/008), не вторую таблицу; migration 011 только metadata, без backfill/удаления строк. Тест отсутствия старой таблицы теперь временно переименовывает её и восстанавливает в finally, сохраняя FK и fixture data. Изменения других авторов сохранены; мной CI/main/Railway не менялись. Runtime всё ещё not_provisioned. Публикация этой итерации выполняется обычным fast-forward push в существующий Draft PR #273.

### Шаг 8 — status/start в текущем мастере (2026-10-14)

Опубликован implementation commit
`d3f48cc5722f49fa349f8eab471db67617fb3f1a`, tree
`b605619c3ce3904a279ab202c8e01900790db3c8`; локальный проверенный эквивалент
того же tree — `345a786`. `VenueOnboarding.tsx` теперь после подготовленного
scope читает существующий server ledger, запускает шаг только пустой командой
`{}` и восстанавливает состояние после reload. Двойной клик блокируется
синхронным UI guard. Сервер дополнительно возвращает `startAllowed`, поэтому
кнопка остаётся закрыта только при реально активной lease, а истёкший claim
можно безопасно продолжить без вычисления срока по часам браузера.

Owner-facing состояния различают ожидание запуска, выполняющуюся проверку,
необходимое действие, retryable error и подготовленную точную привязку. Для
каждого fixed error code показано действие без сырого driver text. Даже при
успехе мастер сообщает «Не запущено · не опубликовано»: база, миграции,
company/venue active flags и runtime не создаются и не включаются. В форме нет
DB URL, host, env name или credential; POST принимает только `{}`. Viewer и
учётная запись без write capability этот шаг не запускают.

Фактические проверки implementation tree:

- provisioning + signed onboarding HTTP/SQL — 71/71; проверены
  `startAllowed=true` до запуска/после истёкшей lease и fixed failure,
  `false` при активной lease/успехе, exact reopen и запрет повторной target work;
- полный Business — 233 passed, 20 skipped только без отдельного внешнего
  PostgreSQL test URL; security — 160/160; typecheck, build и lint изменённых
  файлов — success; Business audit — 0;
- общий lint остановился только на пришедшем `onboarding-invitations.ts:209`
  (`no-control-regex`, commit `94d49e1`); 12 остальных сообщений — прежние Fast
  Refresh warnings. Пересекающийся файл не менялся;
- materialize ×2 дал одинаковый SHA256 diff
  `d75a96d9a88aed8a23ea1723bee3e6421c5e3e64a78a910515e91b3985a9cc67`;
  generated семь runtime-файлов восстановлены и не включены в commit. На
  materialized root: 581/581, `npm run check`, patch-chain audit и root audit —
  success/0;
- локальный Playwright успешно собрал приложение, но не запустил 4
  desktop/mobile сценария из-за отсутствующего Chromium headless shell v1193.
  Расширенный сценарий проверяет настоящий UI/router/PGlite: один POST при
  double click, `action_required`, отсутствие credential-полей и reload ledger.
  Его результат подтверждается только exact browser CI после публикации;
  fixture не считается живой PostgreSQL concurrency или provider authorization.

Факты на границе шага: **есть** UI → status/start API → сохранённый ledger и
безопасный retry первого binding; **нужно сделать** остальные фиксированные
provisioning steps, tenant schema readiness, сборку/запуск приложения и terminal
binding; **внешняя авторизация** всё ещё требуется для реальных Telegram, VK и
Эвотора. Production/main/Railway, реальные БД, env/secrets, webhook, боты,
кассы и данные не изменялись.
Scoped приглашения опубликованы: 94d49e14398e37e2700c7b5529f946dc5562de17, ordinary push 7f596f6..94d49e1; origin SHA подтверждена git ls-remote. Миграции и production/env не применялись.

### Следующая итерация — серверные статусы и сохранённый шаг

Лично добавлена ручная metadata migration 012 и GET/PUT progress для того же draft. Сохраняются только текущий шаг, ID/название терминала и выбор кассовых отчётов. Компания/точка, приложение, provider state и provisioning ledger переиспользуются, tenant/model не дублируются. Статусы вычисляются сервером, arbitrary scope/status/key fields отвергаются. Запись ревизионная, exact replay восстанавливает неопределённый ответ, audit failure откатывает сохранение. Viewer только читает; отзыв и другая компания/точка закрывают доступ.

Приложение/терминал/modules остаются pending до подтверждённого подключения; provider documents_readable не считается событием терминала. Итог not_provisioned/published=false, отчёт unavailable с null суммой/числом чеков, а не ложный 0 ₽. UI восстанавливает шаг/терминал/modules после reload, неизвестный ответ замораживает исходную команду. Незавершённая связь и развёртывание явно показаны по-русски.

Перед публикацией перенесены remote commits до 6732e5b: защищённый provisioning registry/API/UI сохранены, их реализация не приписывается этой итерации. Projection обновляется после изменения provisioning ledger. Provider state различает свежую проверку, stale (>15 минут), первый отказ и отказ после подтверждённого доступа; сумма в переходах не участвует. Все намеренно выключенные модули имеют suspended. Контрольные символы в invitation/progress input проверяются без no-control-regex, прежняя lint-ошибка моего invitation commit исправлена.

Лично выполнено на общем дереве поверх 6732e5b, все exit 0; логи /tmp/spaceverse-workflow-final-gate:

- materialize ×2 и cmp diff — одинаковый исходный diff семи runtime-файлов (365/78), включая server.js/universal-server.js/app.js; canonical копии восстановлены перед commit, generated diff не включён;
- node --test --test-concurrency=2 — 581/581, 0 skipped; npm run check; npm run audit:runtime-patches — passed;
- npm audit; npm audit --omit=dev --audit-level=high; npm audit --prefix admin-platform — 0 vulnerabilities каждый;
- Business npm run typecheck; npm test -- --maxWorkers=2 — 239 passed, 20 прежних integration tests skipped (нет отдельного разрешённого URL, существующие БД/данные не сбрасывались); npm run build — passed;
- npm run lint — exit 0, 0 errors и 12 прежних Fast Refresh warnings; новый код не добавляет warnings;
- workflow signed HTTP/SQL suite — 6/6: replay/revision conflict, два tenant/две точки одной компании, viewer/revoke, scope/status/key spoof, audit rollback, missing schema, fresh/stale/denied provider projection. Тimestamps состояния провайдера синтетические, живой provider не вызывался;
- Playwright invitations+progress — 2/2 desktop/mobile, лог /tmp/spaceverse-workflow-final-e2e.log: приглашение/новый manager/SQL wizard, сохранение terminal/modules/current step, reload, not_provisioned, отсутствие ложного 0 ₽, отзыв → 403;
- прежний onboarding с provider/provisioning UI — 4/4 desktop/mobile, лог onboarding-e2e.log. Провайдер в fixture синтетический, Chromium /usr/bin/chromium.

E2E первоначально обнаружил реальные accessible-name дефекты поля ID терминала и селекта отчётов; исправлены aria-label/aria-describedby и повтор подтверждён 2/2. Не исправлялись попутные favicon и chunk-size предупреждения. Runbook, MODULE-MAP и STATUS-MODEL обновлены вместе с кодом. Осталось: proxy v2 с X-Pivnik-Device-Key, реальное событие терминала/честная проверка, owner venues list и runtime readiness/внешнее развёртывание. Production, реальные credentials/env/устройства/данные не менялись. /mnt/project-files/owner-panel/progress.md всё ещё read-only; журнал ведётся здесь.

### Шаг 9 — read-only готовность tenant-схемы (2026-10-14)

Работа продолжена поверх свежего опубликованного
`1d9c0ed97e3b2f350d217cfdf8c62a6550291ddf`; конкурентный серверный progress
и UI сохранены rebase без force-push. Implementation commits кандидата:
`d290748950689ab302dba0b86a7db73d19ad8166` (schema readiness) и
`8233f54826a144ed444f15f158a53d7011344185` (проекция общего progress). Вторая
фиксированная операция `tenant_schema_readiness` использует тот же
`admin_onboarding_provisioning_steps`, registry, lease/retry и frozen
draft/application/scope. Migration 013 только расширяет CHECK существующего
ledger после 010/012; tenant-схему и данные она не меняет.

После успешного `runtime_database_binding` worker открывает целевую БД через
server-only registry и выполняет `BEGIN READ ONLY`. Он повторно сверяет exact
binding, обязательные таблицы/колонки/типы, PK/FK/check/unique boundaries для
manual root migrations 009 и 017–020. Затем одним агрегированным запросом
проверяет, что users, identities, wallets, transactions и create-request ledger
не содержат строк вне exact runtime/company/venue ownership. Количество,
идентификаторы клиентов и driver text не возвращаются. Неполная схема получает
`TARGET_TENANT_SCHEMA_REQUIRED`, неподтверждённая принадлежность —
`TARGET_TENANT_DATA_OWNERSHIP_REQUIRED`, недоступная БД — ограниченно
повторяемый `TARGET_DATABASE_UNAVAILABLE`. Автоматического backfill/adoption нет.

Creator/scoped GET status и POST run принимают прежнюю signed session и пустой
`{}`; query/body scope, URL и credentials запрещены. До успешной binding UI
показывает зависимость и не делает schema request. После неё UI восстанавливает
ledger, блокирует active lease/double click, разрешает server-authoritative retry
и различает готовую схему, действие владельца и ошибку. Общая progress projection
теперь различает `schema_readiness_pending`, fixed failure и
`schema_ready_runtime_pending`; даже успех оставляет runtime `not_provisioned`,
приложение неопубликованным.

Фактические локальные проверки объединённого дерева:

- профиль provisioning/onboarding/workflow — 82/82;
- полный Business — 244 passed, 20 прежних PostgreSQL integration tests skipped
  без отдельного разрешённого test URL; security — 164/164;
- typecheck, полный build и lint — success; lint содержит только 12 прежних Fast
  Refresh warnings, 0 errors; Business audit — 0 vulnerabilities;
- в чистом detached worktree `npm run materialize` выполнен дважды с одинаковым
  SHA256 diff `ae50df990f6ef99e163a0ad5c9a965e24ab645ccf2ff59a498202794ecf69a37`
  (7 файлов, 365 insertions/78 deletions); materialized root — 581/581,
  `npm run check`, patch-chain audit и root audit — success/0;
- локальный Playwright после этой итерации не считается пройденным: в окружении
  нет Chromium headless shell v1193. Точный desktop/mobile результат нужно брать
  только из CI опубликованного HEAD. PGlite/fixture не выдаются за PostgreSQL
  concurrency, живую авторизацию провайдера или production.

Факты на границе шага: **есть** сохранённая read-only проверка exact tenant-схемы
и ownership с честным retry/progress; **нужно сделать** сборку/проверку tenant
runtime из существующего артефакта, его последующий разрешённый запуск и terminal
binding; **внешняя авторизация** требуется для реальных Telegram, VK и Эвотора.
Production/main/Railway, реальные БД, env/secrets, webhook, боты, кассы и данные
не изменялись.

### Шаг 10 — детерминированный runtime bundle (2026-10-14)

Работа продолжена от проверенного опубликованного HEAD
`cc74b7ba25cd954fae28ca44bd0492473c6cb98b`. Опубликованный implementation
commit `9be1c56616a29cd742225ff4e8f46f782247ccbf`, tree
`e91db5f8789c21196a762109768474ab9b85c051`; локальный проверенный эквивалент
того же tree — `08ccad4d1406519b03ea19a170e0e1ee00dd4fa5`. Третья фиксированная операция
`runtime_bundle_verification` использует тот же provisioning ledger,
server-side scope, lease/claim/retry и frozen manifest после успешной
`tenant_schema_readiness`. Migration 014 только расширяет CHECK существующей
таблицы шагов; она не запускается автоматически и не меняет tenant-данные.

Сервер собирает строгий canonical bundle для уже существующего артефакта
`pivnik-bonus-app`, контракта `tenant-runtime-v1` и двух entrypoint:
`server.js` и `universal-server.js`. Bundle повторно разбирается тем же строгим
parser, из него восстанавливается exact runtime environment и сверяется source
digest frozen manifest. Произвольные поля, URL, credentials, manifest или
artifact из браузера не принимаются; POST принимает только `{}`. Изменённый
bundle получает фиксированный `RUNTIME_ARTIFACT_INCOMPATIBLE`, сырой parser или
driver text наружу не выходит. В ledger сохраняются только безопасные метаданные
и SHA-256 bundle.

Этот SHA-256 подтверждает canonical конфигурацию и compatibility contract, но
не является подписью или hash развёрнутого бинарного артефакта. Поэтому даже
успешный шаг честно оставляет `runtimeStatus=not_provisioned`,
`published=false`, `startAllowed=false`: сервис, Railway, DNS, webhook и
провайдеры не запускаются. UI восстанавливает статус после reload, блокирует
double click/active lease, показывает retryable failure и явно отделяет
«bundle проверен» от «runtime запущен».

Фактические локальные проверки implementation tree:

- strict bundle/parser tests — 10/10; provisioning/onboarding/workflow — 85/85;
  отдельно после финальной правки copy provisioning — 13/13;
- полный Business — 247 passed, 20 прежних PostgreSQL integration tests skipped
  без отдельного разрешённого test URL; security — 167/167;
- typecheck, полный build и lint — success; lint содержит 0 errors и 12 прежних
  Fast Refresh warnings; Business audit — 0 vulnerabilities;
- в чистом detached worktree `npm run materialize` выполнен дважды с одинаковым
  SHA256 diff `ae50df990f6ef99e163a0ad5c9a965e24ab645ccf2ff59a498202794ecf69a37`
  (7 файлов, 365 insertions/78 deletions); materialized root — 582/582,
  `npm run check`, patch-chain audit, root audit и production-only audit —
  success/0;
- локальный Playwright собрал приложение, но 4 desktop/mobile сценария не
  стартовали из-за отсутствующего Chromium headless shell v1193. UI должен
  считаться подтверждённым только после browser CI опубликованного HEAD.
  PGlite/fixtures не выдаются за PostgreSQL concurrency, live authorization или
  production;
- все пять workflow точного опубликованного implementation commit завершились
  `success`: public startup `38611214959`, VK parity `38611214891`, Business
  desktop/mobile browser `38611215168`, release gate `38611215054` и Evotor
  draft checks `38611214927`. В release gate все production/secrets/database/
  deploy/probe шаги 20–26 были `skipped`.

Факты на границе шага: **есть** сохранённая сборка и строгая проверка tenant
runtime bundle из существующего кода; **нужно сделать** привязку к точному
immutable release SHA/registry, затем отдельный возобновляемый launch в
изолированном окружении и terminal binding; **внешняя авторизация** требуется
для реальных Telegram, VK и Эвотора. Production/main/Railway, реальные БД,
env/secrets, webhook, боты, кассы, бонусы и данные не изменялись.

### Следующая итерация — проверка native POS proxy v2 (2026-10-14)

Лично добавлены manual root migration 021 (только квитанции тестовых событий),
shared v2 nonce/MAC contract и native HTTP handler в обоих entrypoint после
прежнего startup guard. SQL повторно проверяет точную runtime/manifest/company/
venue привязку и enabled/unrevoked POS device. Требуется X-Pivnik-Device-Key;
Authorization не заменяет этот заголовок. Event UUID идемпотентен, replay не
обновляет серверное время. Деньги, receipts, users/wallets/purchases не меняются.

Manual Admin migration 015 хранит зашифрованный ключ и проверку для того же draft.
Server выбирает HTTPS origin только из защищённой карты env references, UI не
может подменить адрес или область. Проверка читает status, не создаёт событие
кассы. SQL lease освобождает connection/transaction перед HTTP; completion
повторно проверяет access, lease и terminal/source. Key rotation переупаковывает
сохранённый ключ, audit не содержит raw credential. Flags default-off.

Мастер сохраняет masked key и реально читает native packet. Свежие test event
(5 минут) и полная provider sync (15 минут) подтверждают связь. Пустой полный
24-hour период = 0 ₽/0 чеков; отсутствие связи = unavailable/null; документ с
нулевой суммой = данные. Device key не раскрывает денежные/клиентские строки.
Workflow проецирует device activity и результат, но runtime остаётся
not_provisioned/published=false: startup guard не обойдён, deploy не выполнялся.

Лично выполнено, логи /tmp/spaceverse-pos-final-gate:

- materialize ×2 + cmp — идентичны; generated-only diff canonical→materialized
  370 insertions/83 deletions в прежних 7 файлах, включая server.js,
  universal-server.js, app.js. Canonical snapshot сохраняет новые mount/import;
  generated изменения восстановлены и не включаются в commit;
- node --test --test-concurrency=2 — 587/587, 0 skipped;
  npm run check; npm run audit:runtime-patches — passed;
- npm audit; npm audit --omit=dev --audit-level=high; Business npm audit —
  0 vulnerabilities каждый;
- Business npm run typecheck; npm test -- --maxWorkers=2 — 246 passed,
  20 прежних PostgreSQL integration tests skipped (нет отдельного разрешённого
  URL, их destructive fixture не направлялась на существующие БД);
  npm run build — passed; npm run lint — 0 errors/12 прежних warnings;
- native Node HTTP/SQL suite — 5/5, raw+Express, два tenant/две точки компании,
  scope/Authorization/MAC/nonce, revoked key, lost COMMIT и неизменность wallet;
- Admin signed HTTP → native HTTP/SQL — 7/7: encryption/replay/audit rollback,
  permissions/CSRF, pending event/sync, реальный empty sync, stale/foreign key,
  invalid MAC/nonce, lease и revoke during request; expired lease recoverable;
- node /tmp/spaceverse-pos-postgres-proof.mjs — PASS, два новых retained
  синтетических PostgreSQL DB: 6 конкурентных save = 1 row/audit, 4 повторных
  probes получают 409, HTTP не держит idle SQL transaction, 8 конкурентных
  native events = 1 квитанция/время; проверенный пустой sync даёт 0, не launch;
- Playwright invitations/progress/proxy — 4/4 desktop/mobile с реальными
  signed router и native handler, synthetic SQL/provider/device fixtures.
  До успешного повтора E2E выявил duplicate React sibling key, исправлен в UI;
  тесты также явно открывают нужный draft при нескольких точках.
- прежний onboarding/provider/provisioning UI — Playwright 4/4, лог
  /tmp/spaceverse-pos-final-gate/legacy-onboarding-e2e.log.

Runbook и MODULE-MAP обновлены в этой итерации. Реальные кассы, provider accounts,
Railway/env/secrets, production DB, Telegram/VK и deployment не проверялись и не
менялись. Осталось в #273: owner list/status/attention, общая SPACEVERSE панель,
мобильные состояния и документированный барьер внешнего runtime provisioning.
Новый Mobile Integration Hub — отдельный scope: сначала architecture/contract/
4-step UX, затем отдельный sandbox vertical PR после исходного #273; в этот PR
не добавляется. Статусы sandbox не будут выдаваться за production подключение.

Перед push remote продвинулся до b499cb1: чужие schema-readiness/runtime-bundle
изменения d290748/8233f54/9be1c56 и их журналы сохранены rebase, без force.
Моя неопубликованная Admin migration переименована 013→015; 013/014 чужой работы
сохранены. Общий progress/UI учитывает обе новые provisioning проверки и POS
projection. Native test fixture перенесена внутрь Admin test tree; Dockerfile
копирует native handler для той же тестовой сборки, CI не менялся.

Повторён полный gate на объединённом дереве (2026-10-15), логи
/tmp/spaceverse-pos-merged-gate: materialize ×2 + cmp passed; node --test
--test-concurrency=2 — 587/587; npm run check и audit:runtime-patches passed;
root npm audit, production audit и Business audit — 0 vulnerabilities;
Business typecheck/build/lint passed (0 errors/12 прежних warnings), vitest
254 passed/20 прежних skipped; Playwright invitations/proxy 4/4 и прежний
onboarding/provider/provisioning 4/4; новая retained PostgreSQL proof — PASS.
Generated runtime diff и E2E screenshots сохранены вне checkout, canonical
runtime sources восстановлены перед commit; новые POS mounts сохранены.
Docker image отдельно не собирался; migration/production/device/deploy не
выполнялись. Публикация проверяется обычным push и git ls-remote.

POS шаг опубликован обычным push b499cb1..d3e5f6f; git ls-remote подтвердил
d3e5f6fba5919fff472d0c57a6e101083b197f87. PR #273 остаётся Draft.

### Owner list, SPACEVERSE interface и обращение разработчику (2026-10-15)

Лично добавлен GET /api/admin/onboarding/venues: единый read-only список из
прежнего active venue resolver и scoped drafts/prepared venues. Tenant/auth/
runtime model не дублируются, миграция не нужна. Scope выбирается подписанной
сессией/SQL, arbitrary company/status и неверная/дублированная пагинация
отвергаются. 25 строк на страницу, все точки доступны через «Показать ещё».
Каждая prepared точка переиспользует настоящий workflow projection. Legacy
metadata active без подтверждённой связи остаётся pending/unknown с null суммой.
Две активности разделены: событие устройства и изменение оператором.

Ошибка source одной точки показывает failed/degraded и requiresAttention,
не скрывая остальные точки. Revoke при projection убирает строку/закрывает
доступ. UI обновляет статусы, показывает объяснение и открывает нужный wizard,
включая повторное открытие того же draft. Подтверждённый пустой отчёт имеет 0;
неизвестная сумма и непустые данные не смешиваются.

Вход, sidebar, invite claim и master получили SPACEVERSE branding и общие
тексты. В opt-in SPACEVERSE flow скрыты legacy-only wheel/achievements/broadcast
и специализированные content managers ПИВНИКА; общие менеджеры переиспользуются.
Старая совместимость при выключенном workflow flag сохранена. Новая панель не
выдаёт наличие Admin connection за работающие приложения гостей. Пустое состояние
подготовленной точки не говорит, что ей вообще не назначено заведение.

«Нужна помощь разработчика?» позволяет описать проблему и скопировать текст с
ID, безопасным кодом состояния и диагностикой. Это подготовка обращения,
не доставленная заявка и не автоматическая отправка. Сохранённых ключей/кодов
приглашения в диагностике нет. Прямой канал сообщений/доступ разработчика
планируется в отдельном Hub scope; чужие сообщения инструментами не отправлялись.

Лично выполнено на дереве поверх d3e5f6f, логи /tmp/spaceverse-owner-final-gate:

- materialize дважды + cmp — identical; прежние 7 generated файлов дают
  365 insertions/78 deletions (server.js/universal-server.js/app.js включены);
  snapshot восстановлен перед commit, generated diff не исправлялся;
- node --test --test-concurrency=2 — 587/587; npm run check и
  npm run audit:runtime-patches passed;
- root npm audit, npm audit --omit=dev --audit-level=high и Business audit —
  0 vulnerabilities;
- Business typecheck, build, lint passed (0 errors, 12 прежних Fast Refresh
  warnings); npm test -- --maxWorkers=2 — 258 passed, 20 прежних skipped;
- workflow/owner list + native proxy signed HTTP/SQL — 18 tests: две компании,
  две точки одной компании, новый viewer видит ровно одну точку, revoke → 403,
  source corruption одного приложения, 34 доступные записи на двух страницах
  без дублей/чужой компании, реальные native empty-sync/activity проекции;
- Playwright invitations/owner list/proxy — 4/4 desktop/mobile: полный local
  flow, zero/unavailable distinction, список/переоткрытие, SPACEVERSE title,
  отсутствие legacy navigation, реальная clipboard copy обращения без key,
  no horizontal overflow; прежний onboarding/provider/provisioning — 4/4;
- E2E выявил неправильное accessible name textarea; исправлены aria-label и
  проверка textarea value. Source corruption первоначально давал общий 400;
  исправлена изоляция ошибки по строке списка и подтверждён полный повтор.

Это не завершение реального самостоятельного запуска: требуются immutable
release registration, отдельный разрешённый runtime launch, terminal provisioning
и проверки реального провайдера/устройства. Новый Mobile Integration Hub пока
не реализован и не добавлен в #273; сначала отдельная architecture/contract/UX
итерация, потом sandbox vertical. Production/main/Railway, реальные env/secrets,
БД/данные/кассы/Telegram/VK, CI и kiosk этой итерацией не менялись.

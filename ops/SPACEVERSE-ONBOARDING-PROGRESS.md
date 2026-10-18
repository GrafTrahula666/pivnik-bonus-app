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

Owner list/interface шаг опубликован: 9011b2f80497ac5c08f5176af72b7d0f5cd656b2,
ordinary push d3e5f6f..9011b2f; git ls-remote совпал. PR #273 остаётся Draft.

### Утверждённая версия серверных модулей, bundle v2 (2026-10-15)

Лично добавлен spaceverse-runtime-release.js и явный build-only CLI. Он читает
два существующих entrypoint и closure literal relative imports/re-exports/
dynamic imports, package.json/lock, проверяет отсутствие traversal/symlink и
границы размера; не исполняет код, не запускает сервис/миграции/network.
CLI проверяет base source SHA против git HEAD, пишет новый non-secret файл
эксклюзивно (не перезаписывает), fingerprint фиксирует реальные байты.

Server-only assembler принимает file/SHA/fingerprint только из operator env
references, никогда из браузера, и сравнивает их с фактическими файлами. При
пустой регистрации нет fallback на description-only bundle. Shared bundle v2
включает code proof в checksum; v1 остаётся читаемым для совместимости.
Production Admin provisioning требует code proof. Старый succeeded descriptor
проецируется как action_required без мутации GET; прежний ledger safely
reclaims тот же шаг и после утверждения получает v2. Новых tenant/auth/registry
моделей и миграций нет. Startup guard не ослаблен: not_provisioned/published=false.

Workflow/UI различают проверенное описание и проверенную версию модулей.
Docker source copy включает нужные файлы для Node closure verification;
сам Docker image в этой итерации не строился и не деплоился. Image digest,
frontend assets и вычисляемые импорты не покрываются этим proof — это честно
указано в coverage/runbook, не выдаётся за готовый hermetic release.

Лично выполнено, /tmp/spaceverse-release-final-gate:

- materialize ×2 + cmp — identical; прежний generated diff 7 файлов
  365 insertions/78 deletions, включая server.js/universal-server.js/app.js;
  canonical snapshots восстановлены перед commit, patch-chain не исправлялся;
- node --test --test-concurrency=2 — 591/591; npm run check и
  npm run audit:runtime-patches passed; root npm audit и production audit — 0;
- Business typecheck/build/lint passed (0 errors/12 прежних warnings),
  npm test -- --maxWorkers=2 — 262 passed/20 прежних skipped, npm audit — 0;
- root focused release + manifest — 14/14: фактические файлы/dependency changes,
  modified/omitted/duplicate records, traversal/symlink, wrong SHA/fingerprint,
  v1 compatibility/v2 tamper и неизменный запрет launch;
- Business release/provisioning/workflow — 27/27; signed HTTP onboarding suite
  65/65: без регистрации action_required, с реальным file fingerprint v2;
  legacy succeeded descriptor нельзя использовать как утверждённый release;
- явный node scripts/build-spaceverse-runtime-release.mjs с base SHA 9011b2f
  на materialized tree — success, 45 modules, fingerprint
  64289ea917188724b251b85620014307742d834de8653e86178f24d0f384a9dc;
- Playwright invitations/proxy/owner/release — 4/4 desktop/mobile: действительный
  code proof и signed HTTP/UI. Binding/schema predecessors в этом UI subset
  явно synthetic; их actual SQL workers отдельно проверены Vitest. Никакой
  physical device/image/production launch этим не подтверждался;
- прежний onboarding/provider/provisioning — 4/4 desktop/mobile.

Расширенный E2E выявил burst обновлений owner list до 60/min: добавлен 250ms
debounce чтения, server rate limit сохранён. Прежние favicon/chunk-size
предупреждения не исправлялись. Корневой source Docker copy check сохранён.
Следующий исходный scope: конкретный immutable image/release, resume-safe
runtime launch и terminal provisioning, затем полная проверка критического
пути. Реальные deployment/устройства/провайдеры/БД/env по-прежнему не трогались.
Mobile Integration Hub отдельно: architecture/contract/UX, потом sandbox vertical;
его реализация не начата и не смешивается с #273.

### Локальный immutable runtime image, без запуска сервиса (2026-10-15)

Лично добавлены build-only `scripts/prepare-spaceverse-runtime-image.mjs`,
`ops/spaceverse-runtime.Dockerfile`, strict image inspection verifier и отдельный
tenant entrypoint. Работа поверх 05778c4; прежние авторы onboarding/provisioning
не приписываются этой итерации. Ни tenant model, ни ledger не дублируются,
миграций нет. Новый production API не включён.

Контекст копирует actual release closure, tracked public root assets и manual
SQL; исключает .git/.env/.npmrc/Business/test/node_modules. Он повторно проверяет
скопированную closure и не перезаписывает существующий каталог. Image base Node
22 закреплён digest; dependencies устанавливаются по lockfile внутри Docker
offline, ignore-scripts, network=none. Публичный npm cache и logs доступны только
через build mounts/tmpfs, host dependencies/proxy/CA не встраиваются. Контракт
требует independently expected immutable local image ID, linux/amd64, совпадающие
source SHA/fingerprint, user node, exact tenant wrapper и ограниченные baked env.
Mutable tag, root/legacy/prestart, чужой source/ID и неизвестные env запрещены.

Wrapper перепроверяет bundle v2 и файлы, затем сохраняет существующий запрет
старта, без npm prestart, подключения к реальной БД или legacy fallback.
Локальный image ID не является registry publication или работающим приложением.
runtime остаётся not_provisioned/published=false. Server-side image registration,
resume-safe разрешённый runner/activation и terminal provisioning ещё нужны;
критический путь целиком готовым не считается. Mobile Integration Hub по-прежнему
отдельная последующая работа после исходного scope #273.

Лично выполнено, логи /tmp/spaceverse-image-final-gate:

- materialize дважды + cmp — identical; исходный generated diff 7 файлов
  365 insertions/78 deletions, включая server.js/universal-server.js/app.js,
  отдельно сохранён и не исправлялся как побочная задача;
- node --test --test-concurrency=2 — 595/595; npm run check и
  npm run audit:runtime-patches passed; root npm audit и production audit — 0;
- Business npm run typecheck/build/lint — passed, 0 errors/12 прежних warnings;
  npm test -- --maxWorkers=2 — 262 passed/20 прежних skipped; npm audit — 0;
- node --test test/spaceverse-runtime-image.test.js — 4/4: настоящий allowlisted
  context, повторное чтение/проверка copied release, отсутствие приватных файлов,
  запрет overwrite, readable non-root permissions, смена image/source/config,
  duplicate/unknown baked env, actual child process denial до загрузки БД;
- node scripts/prepare-spaceverse-runtime-image.mjs --output
  /tmp/spaceverse-runtime-image-readable-context — success, 159 source files,
  45 modules, 12 152 487 bytes; source 05778c4, actual materialized fingerprint
  b16703aacfc7ae9917c8cf636269bf39a5b89d0701c03ec54ab687ff7a4ce160;
- docker build --build-context npm-cache=/tmp/spaceverse-runtime-npm-cache
  с exact release build args — exit 0; actual local image
  sha256:fa61dd588d07beb5aacb81fb816343725a8c24ef79ddd0c27e4fa046ceeb3f00;
- node /tmp/spaceverse-image-final-gate/image-smoke.mjs — 4/4 actual Docker
  containers, network none/read-only/cap-drop ALL/no-new-privileges: missing bundle,
  legacy mode, valid synthetic bundle без разрешённого binding/launch,
  неверный code proof; все exit 78, stdout пустой, только безопасный error code.
  Контейнеры/образ сохранены, реальных пользователей/денег/устройств нет;
- npx playwright test --config /tmp/spaceverse-invitations-playwright.config.mjs
  и /tmp/spaceverse-onboarding-playwright.config.mjs — 4/4 + 4/4 desktop/mobile.
  Это прежние signed Admin HTTP/SQL/UI scenarios, не production launch;
  новый image gate отдельно проверен настоящими локальными контейнерами.

Первая online npm Docker install завершалась exit-handler error; frozen host
npm ci успешно заполнил public cache, offline Docker install прошёл. Первый
smoke обнаружил влияние host umask 077 на permissions: исправлены только public
context file/directory modes, context root остался 0700; повтор подтвердил node
user и readable files. Binding guard корректно маскирует synthetic denied query
как SPACEVERSE_RUNTIME_BINDING_UNAVAILABLE, без доступа к реальному PostgreSQL.
Прежние favicon/chunk-size/lint предупреждения не исправлялись. Production,
Railway, CI, реальные device/provider настройки и данные не менялись.
Запрошенный /mnt/project-files/owner-panel/progress.md остаётся недоступным для
записи; журнал ведётся здесь. Canonical runtime files и E2E screenshots
восстанавливаются перед commit, generated diff не публикуется.

### Регистрация образа в существующем мастере, bundle v3 (2026-10-15)

Предыдущий локальный image step опубликован лично как a931aa9 в том же Draft
PR #273; эта итерация поверх него подключает проверку к существующему assembler,
runtime_bundle_verification ledger, workflow и UI. Новых tenant/auth/registry
таблиц или миграций нет. Включение по-прежнему закрыто прежним default-off
ADMIN_ENABLE_ONBOARDING_PROVISIONING; Admin не вызывает Docker, deployment или
публикацию image.

Server-only references ADMIN_RUNTIME_IMAGE_ID/ADMIN_RUNTIME_IMAGE_INSPECTION_FILE
сверяют independently expected local image identity и inspection config/source с
actual текущим code proof. Browser не передаёт image ID, file или metadata.
Bundle v3 включает image ID/platform/contract в общий checksum вместе с exact
manifest scope и code proof; v1/v2 читаются, но production verifier требует v3.
Null proofs не позволяют подменить schema version при старом checksum.
Прежний v2 success без image proof GET проецирует как action_required без записи
в БД; retry безопасно использует тот же ledger/lease и увеличивает attempt.
UI показывает отдельные причины missing code/missing image/image mismatch и
«Образ проверен; приложение ещё не запущено». Workflow остаётся pending, runtime
not_provisioned/published=false/startAllowed=false. Успех является сохранённым
результатом проверки артефакта на updatedAt, не свидетельством живого запуска.

Лично выполнено, /tmp/spaceverse-image-registration-final-gate:

- materialize ×2 + cmp — identical; прежний generated diff 7 файлов 365/78,
  включая server.js/universal-server.js/app.js, отдельно сохранён;
- node --test --test-concurrency=2 — 596/596; npm run check и
  npm run audit:runtime-patches passed; root/full/production npm audit — 0;
- Business typecheck/build/lint passed, 0 errors/12 прежних warnings;
  npm test -- --maxWorkers=2 — 263 passed/20 прежних skipped, npm audit — 0;
- focused root release/image — 9/9; focused Business release/provisioning/
  workflow/signed HTTP — 93/93: v2 upgrade в той же записи, exact replay,
  mutable/wrong image ID, mismatched source/config, symlink/invalid file,
  запрет browser image selection, отсутствие users/wallets writes;
- явный context builder и offline docker build — success; actual source base
  a931aa9, 45 modules/160 files, fingerprint
  7e694da519326b998e35b8a9412ae16ec710ba745bb9d77ef9f4828c96e0390e;
  local image sha256:3f7e6c888eeaa26a7c0731d5354be2767be0750b454c54641de8c2f2385e3c8f;
- node /tmp/spaceverse-image-registration-final-gate/image-smoke.mjs — 4/4
  actual containers с synthetic scope: network none/read-only/cap-drop ALL,
  missing bundle/legacy denied/valid v3 launch denied/wrong code proof;
  все exit 78, безопасные codes, containers retained, no external actions;
- SPACEVERSE_E2E_IMAGE_INSPECTION_FILE=/tmp/spaceverse-image-registration-final-gate/image-inspection.json
  npx playwright test --config /tmp/spaceverse-invitations-playwright.config.mjs
  — 4/4 desktop/mobile, с actual built image evidence. E2E явно сравнивает
  возвращённые ID/fingerprint с docker inspect, проверяет missing code → missing
  image → v3 verified и сохраняющийся текст «Заведение ещё не запущено»;
- npx playwright test --config /tmp/spaceverse-onboarding-playwright.config.mjs
  — 4/4 прежних desktop/mobile scenarios. Binding/schema predecessor rows в
  image UI subset по-прежнему явно synthetic; отдельные workers проверены SQL
  tests. Unit/HTTP fixtures используют synthetic inspection metadata и не
  выдаются за доказательство deployment.

Runbook/MODULE-MAP и Docker copy declarations обновлены с кодом. Canonical
runtime sources/screenshots восстанавливаются перед commit; generated outputs
не публикуются. CI status через запрещённый GitHub API не подтверждён; сами CI
files не менялись. Production/Railway/реальные БД, устройства и providers не
трогались. Следом нужен default-off resume-safe runner/activation с повторной
проверкой текущей image регистрации и terminal provisioning, затем полный E2E
критического пути. Mobile Hub не начат: отдельная architecture/contract/UX
итерация после исходного scope #273. Журнал остаётся в репозитории, поскольку
/mnt/project-files/owner-panel/progress.md недоступен для записи.

### Default-off tenant API: настоящий запуск, отзыв и продолжение (2026-10-15)

Лично реализован узкий tenant API внутри прежнего image, поверх 1662b8b.
Он переиспользует существующие verified runtime binding, customer auth/wallet
и POS adapters. Их прежняя реализация не выдаётся за работу этой итерации.
Новая permission таблица ссылается на canonical binding; второй tenant/auth
registry нет. Shared startAllowed=false и guard обоих legacy entrypoint
сохранены. Новое разрешение позволяет только отдельный tenant API, не legacy
bootstrap, не публикацию приложения и не активацию company/venue.

Добавлены spaceverse-tenant-service.js, protocol readiness и manual additive
root migration 022. Migration создаёт пустую таблицу разрешений, не выдаёт их,
не меняет users/wallets/purchases и не входит в automatic startup. Permission
хранит только hash server-only ключа, привязана к manifest/bundle/image, срок
не более 24 часов. На каждый запрос проверяются прежний exact binding, срок и
state; revoke/suspend/expiry/смена binding закрывают доступ. Session advisory
lock допускает один serving процесс runtime, без открытой транзакции на время
HTTP. Новый разрешённый процесс использует прежние customer/session/wallet.

Image wrapper требует отдельный default-off SPACEVERSE_ENABLE_TENANT_SERVICE,
v3, operator image ID, dedicated DB/session/launch credentials. Нет fallback
на PIVNIK DATABASE_URL или глобальные auth secrets. Dynamic service imports
исполняются после проверки code proof; wrapper и его literal import closure
теперь входят в release fingerprint. .env.example/env.example и Docker copies
синхронизированы. Новые реальные environment bindings/секреты не менялись.

Readiness подписывает nonce, exact company/venue/runtime/checksum, image/bundle,
source/fingerprint, authorization ID/expiry. Проверяются MAC, nonce и свежесть
до 30 сек. Proof обозначает tenant-api-only/published=false, не active venue.
Обычный /health тоже сохраняет runtimeStatus=not_provisioned. Frontend не
публикуется, финансовые endpoints недоступны, POS/касса отдельно требуют своих
проверок. Admin orchestration/выдача разрешения через мастер ещё не подключены:
запуск проверялся исключительно в локальной synthetic test среде.

Лично выполнено, логи /tmp/spaceverse-tenant-service-final-gate:

- materialize ×2 + cmp — identical. Прежний generated diff 7 файлов 365/78,
  включая server.js/universal-server.js/app.js, сохранён отдельно и не чинился;
- node --test --test-concurrency=2 — 602/602; npm run check и
  npm run audit:runtime-patches passed; root/full/production npm audit — 0;
- Business typecheck/build/lint passed, 0 errors/12 прежних warnings;
  npm test -- --maxWorkers=2 — 263 passed/20 прежних skipped; npm audit — 0;
- focused root tenant service/release/image — 15/15; focused Business
  release/provisioning/workflow/signed HTTP — 93/93;
- PGlite/real HTTP: 3 isolated venue databases in 2 companies; signed identity,
  actual zero wallet/hasData, foreign session and client scope rejection,
  unavailable financial route, expiry/revoke/wrong image/bundle denial,
  signed nonce/MAC/freshness checks и продолжение после нового разрешения;
- actual child process в скопированном image context не использует legacy
  DATABASE_URL при отсутствии dedicated URL: exit 78 CONFIGURATION_REQUIRED;
- node scripts/prepare-spaceverse-runtime-image.mjs --output
  /tmp/spaceverse-runtime-tenant-service-context и offline docker build — success;
  source base 1662b8b, 49 modules/162 files, fingerprint
  9f444cb2722d1f1e48a390bb1cdac64cd10406f58fe70384745e9f5a186088f7,
  local image sha256:e6d9e20a5daec7ec82b379a4708db336f9fc284a63a50280a3bf5ce0b77b226a;
- node /tmp/spaceverse-tenant-service-final-gate/container-proof.mjs — success:
  настоящий PostgreSQL 17, новая сохранённая synthetic DB, 3 независимых Docker
  процесса одного immutable image, read-only/cap-drop ALL/no-new-privileges,
  публикация порта только на loopback. Signed readiness и настоящий auth/wallet
  HTTP дают 0/hasData=true. Второй процесс отвергнут exit 78 ALREADY_SERVING;
  pg_stat_activity подтверждает отсутствие idle in transaction. Отзыв даёт
  503 и остановку первого процесса; новое разрешение запускает процесс заново,
  прежняя сессия работает, exact auth replay сохраняет 1 customer/1 wallet.
  Собственные тестовые API остановлены после proof, контейнеры/данные сохранены;
- Playwright с SPACEVERSE_E2E_IMAGE_INSPECTION_FILE текущего actual image:
  invitations/proxy/owner/image — 4/4 desktop/mobile; прежний onboarding — 4/4.
  Fixture predecessor binding/schema в UI subset остаются synthetic. Ни этот
  UI E2E, ни локальный API proof не выдаются за полную production цепочку.

После возобновления среды локальный PostgreSQL был остановлен, private npm cache
и временные Playwright configs отсутствовали: поднят прежний тестовый контейнер,
cache восстановлен frozen npm ci без scripts, configs восстановлены вне checkout.
Первые regex assertions слишком широко учитывали FK ON DELETE RESTRICT; проверка
исправлена на DML statements, actual repeatable migration/данные подтверждены.
Прежние favicon/chunk-size/lint предупреждения не исправлялись. Canonical
runtime files/screenshots восстанавливаются перед commit; generated diff не
публикуется. CI не подтверждён из-за ограничения GitHub API. Production,
Railway, реальные устройства/провайдеры/данные/секреты и CI files не менялись.

Следующий минимальный шаг: существующий Admin provisioning ledger должен
безопасно выдать/возобновить scoped launch permission и получить actual readiness
через разрешённый runner. Затем terminal provisioning и полный критический E2E.
Самостоятельное подключение целиком пока не готово, master/venue остаются pending.
Mobile Integration Hub — отдельная следующая работа после исходного scope #273;
не начат в этой итерации. Журнал остаётся в репозитории: запрошенный /mnt/project-files
недоступен для записи. MD-отчёт владельцу сохранён отдельно в /workspace.

## 2026-10-17 — уточнение SaaS-продукта и HTTP-проверки аудита (#270)

Владелец уточнил scope: только существующий сайт
https://admin-pilot-production.up.railway.app/ как отдельный SPACEVERSE CRM SaaS,
без выпуска в Эвотор Маркете. Приоритеты: самостоятельное подключение источника
по ключу с инструкциями, клиентская база и поиск, работа с телефона, поддержка,
подписка. Дополнительно нужен AI-помощник с ключом выбранного поддерживаемого
провайдера, анализом разрешённых данных точки, серверным хранением ключей,
ограничением запросов/расходов и честным описанием отсутствующих данных.
Mobile Hub, гостевые приложения и киоск не являются зависимостями CRM-релиза.
Исправленный план сохранён вне checkout:
`/workspace/SPACEVERSE-CRM-SAAS-PLAN-2026-10-17.md`; прежний план Маркета помечен
устаревшим. AI и перечисленные CRM-функции этим документом не реализованы.

Read-only GET публичной страницы: HTTP 200, title «SPACEVERSE — Панель владельца».
Это не проверка входа, данных или готовности SaaS. GitHub API подтвердил MERGED
для #273 и OPEN/Draft для #270. База текущей проверки — origin/main f1b7123;
обновление main включено в существующую ветку #270 обычным merge без переписывания
истории. Другие открытые PR не менялись.

Исходное SQL-исправление и два SQL-теста принадлежат существующему d2d23b6,
не являются новой работой этой итерации. Лично добавлен `audit-http.spec.ts`:
настоящие HTTP-запросы и вход с session cookie через Business router,
исполняемый SQL в изолированной PGlite; две компании, две точки одной компании,
owner/trusted/SUPER_ADMIN, запрет чтения чужой компании, игнорирование подмены
scope через query, запрет глобального аудита обычным аккаунтам, отзыв доступа.
MODULE-MAP дополнен этим контрактом. Изменений схемы и write-path нет.

Проверки и диагностика, логи `/tmp/spaceverse-saas-gate`:

- Замороженные `npm ci` в root и admin-platform выполнены с
  `--cache /tmp/spaceverse-npm-cache`. Первый запуск с системным cache завершился
  ENOENT для `/home/agent/.npm/_cacache`; повтор с доступным cache успешен,
  проверка integrity не отключалась, lockfiles не менялись.
- Целевой `npm test -- --maxWorkers=2 server/tests/audit-http.spec.ts
  server/tests/audit-venue-scope.spec.ts server/tests/trusted-director-http.spec.ts`:
  44 passed. Первый прогон выявил неверное ожидание тестовой фикстуры о глобальном
  журнале: настоящий login добавляет `auth.login`; ожидание исправлено.
- Контроль регрессии: временно подставленный неизменённый read module из main
  даёт 3 failed / 4 passed в новых HTTP-тестах: в ответ выбранной точки попадают
  соседняя точка и запись компании. Исходный исправленный файл восстановлен.
- `npm run materialize` дважды: tracked bytes идентичны между первым и вторым
  прогоном. Чистый запуск снова создаёт generated diff: 7 файлов, 365 insertions /
  78 deletions, включая `server.js`, `universal-server.js`, `app.js`, а также
  `achievements.js`, `index.html`, `red-cosmos-v2.js`,
  `scripts/v22-data-audit-and-repair.mjs`. Diff и SHA-256 сохранены отдельно;
  его исправление не входит в задачу, эти файлы не публикуются в PR.
- `node --test --test-concurrency=2`: 622 passed, 0 failed/skipped.
- `npm run check`: exit 0. Root и Business `npm audit`: 0 vulnerabilities.
- Business `npm run typecheck`, `npm run build`: exit 0; прежнее предупреждение
  Vite о размере chunk сохраняется. ESLint нового HTTP-теста: exit 0.
- Первичный полный Business `npm test -- --maxWorkers=2` параллельно с root:
  269 passed / 3 failed / 20 skipped. Все три ошибки — timeout 5000ms в тяжёлых
  существующих onboarding-provisioning тестах (фактически 5.9–7.4 сек).
  Повтор без одновременного root-прогона, `npm test -- --maxWorkers=1`:
  272 passed / 20 прежних skipped, 30 passed / 1 skipped suite, exit 0.
  Таймауты и проверки не ослаблялись. Для этой среды с CPU quota 4 полные
  root/Business прогоны выполняются последовательно.
- Локальный `npm run dev:web -- --host 127.0.0.1 --port 5173 --strictPort`
  запущен: GET `/` и `/src/main.tsx` дали HTTP 200 и ожидаемый HTML/модуль.
  Свой Vite остановлен после проверки.
- Сохранены проверенные install_script/start_skill в черновике cloud environment:
  status=saved, requires_publish=true. Это инструкции разработки; их применение
  к новым сессиям требует Review/Save/Publish в настройках среды и не является
  публикацией SaaS-сайта. Секреты, переменные и network policy не менялись.

Не проверены: полный браузерный SaaS E2E, реальная авторизация на публичном сайте,
живые ключи/данные провайдеров, платежи, AI API и production deploy. Для этой
итерации проверяется только серверный контракт аудита; сайт целиком к релизу не
объявляется готовым. Следующий продуктовый шаг после #270 — безопасный CRM-путь
для стороннего tenant и простой мастер источников, затем поиск и мобильные
сценарии, AI отдельным небольшим PR. PR в main не объединялся, deploy не
выполнялся; production-БД, Railway, секреты, CI и реальные устройства не менялись.

## 2026-10-18 — SaaS-аудит, roadmap и lifecycle CRM

Новое ТЗ владельца: существующий сайт — коммерческая CRM SaaS с публикацией в
Эвотор.Маркете; AI пока только архитектура/тестовый контур без платных API.
Ранее #270 был объединён в 5230083 и прошёл существующий автодеплой Telegram/VK
по отдельному разрешению владельца. Это разрешение не относится к новой ветке
`spaceverse/saas-product-roadmap-20261018`: merge/deploy здесь не выполняются.

Read-only проверены свежий origin/main 5230083, 330 origin refs и 58 открытых PR.
Изучены относящиеся к задаче main modules/Do not break, документация, конфигурации
и реализации в AI/CRM/pilot/integration ветках. #101 содержит legacy AI shell,
#115/#197/#212 — отдельную работу Customer 360; #280–282 затрагивают живой Evotor
bridge/sync и не импортировались. Имя старой remount-ветки не доказывает фикса:
эта ветка является предком main, а актуальный App оставался без CRM scope key.

Созданы SAAS-PRODUCT-AUDIT.md, SAAS-COMPETITOR-RESEARCH.md,
EVOTOR-MARKET-REQUIREMENTS.md, SAAS-PRODUCT-ROADMAP.md,
SAAS-ANALYTICS-AI-ARCHITECTURE.md в ops/. Есть readiness/risk matrix, P0–P3,
приёмка и зависимости, источники/даты/оговорки тарифов, proposed START/BUSINESS/
PRO + независимый AI add-on, metric definitions/DSL/export и безопасный AI
interface/usage/tools. Это спецификация; mock adapter/AI feature flags пока
не реализованы, paid model/API не подключались. Склад/поставщики/инвентаризация/
производство/киоск исключены. Маркетинговые заявления конкурентов не выдаются
за результаты собственного тестирования или доказанную причинность.

Официальные материалы iiko, Quick Resto, UDS, Mindbox, MAXMA получены; база
знаний r_keeper доступна несмотря на 403 основного сайта; дополнительно изучена
главная RetailCRM. Для Poster основной/developer/help ресурсы — 403. Официальные
Эвотор developer/market/main — 403, поэтому комиссии/договоры/лицензирование и
модерация остаются UNKNOWN, с проверяемым чек-листом и внешними задачами владельца.
Числа не придуманы; истёкшая 30.09 акция iiko не считается текущей ценой.
Файлы/manifest HTTP-исследования сохранены в /tmp/spaceverse-saas-research-20261018.

Первое исправление: при смене actor/company/venue CRM теперь немедленно
размонтирует старые таблицу, фильтры, выбранного клиента и формы. Drawer
привязан к scope/customer; очистка и cancellation guard игнорируют поздние
detail responses. На неизменённом main browser воспроизвёл 3 ошибки: другая
точка той же компании, другая компания, поздний ответ старой карточки.
После исправления 6/6 desktop/mobile проходят. Новый бизнес в API-фикстуре
честно возвращает 409 «источник ещё не подключён», старые данные при этом
исчезают. Это UI lifecycle, не новое server authorization и не готовый tenant
CRM adapter. Backend, деньги, модели, migrations и CI workflows не менялись.
MODULE-MAP обновлён в той же ветке.

Лично выполнены проверки; логи /tmp/spaceverse-saas-research-20261018/gates:

- frozen npm ci root/Business с --cache /tmp/spaceverse-npm-cache успешны;
  Playwright Chromium установлен в /tmp/spaceverse-playwright, integrity/TLS
  не отключались. Первоначальная CLI-команда Playwright ошибочно передала путь
  как второе имя project; после `--project=desktop` тесты реально выполнились;
- npm run materialize ×2: tracked bytes идентичны между прогонами. Чистый
  materialize снова дал 7 generated файлов, 365 insertions / 78 deletions:
  server.js, universal-server.js, app.js, achievements.js, index.html,
  red-cosmos-v2.js, scripts/v22-data-audit-and-repair.mjs. Patch/SHA-256 сохранены,
  собственные generated outputs восстановлены, в PR они не входят;
- node --test --test-concurrency=2: 622 passed / 0 failed/skipped;
- npm run check: exit 0; root/Business npm audit: 0 vulnerabilities;
- Business npm test -- --maxWorkers=1: 272 passed / 20 прежних PostgreSQL skipped;
  root и Business полные прогоны выполнялись последовательно;
- Business npm run typecheck, npm run build: exit 0; прежний chunk warning Vite;
  ESLint затронутых App/ProductionCRM/new E2E: exit 0;
- playwright --config=playwright.evotor.config.ts --workers=2: 12 passed
  (6 CRM scope/race и 6 прежних cash desktop/mobile);
- npm run test:e2e:onboarding: 4 passed desktop/mobile;
- git diff --check и проверка локальных ссылок пяти документов: passed.

Read-only публичный CRM: HTML/health HTTP 200, ok=true, session без cookie
authenticated=false/demo=true/invitations=false. Закрытые реальные owner screens,
native PostgreSQL suite, живая касса/Маркет, реальные ключи/оплата/AI не проверены.
Новые регистрации, заявки/сообщения продавцам, merge, production deploy, правки
Railway/секретов/CI и обновления устройств не выполнялись. Следующий P0 —
standalone CRM adapter и активация поверх существующих canonical ownership и
onboarding; правила Маркета, TLS/CA и лицензии остаются отдельными блокерами.

По cloud-environment-onboarding:setup сохранены install_script/start_skill в
черновике конфигурации среды: frozen installs, writable npm/browser caches,
Chromium, последовательные suites и startup/readiness. Обновлена цель SaaS +
Маркет; AI только architecture/synthetic. status=saved, requires_publish=true;
для будущих задач владелец проверяет/сохраняет настройки и публикует именно
среду разработки. Это не production deploy и не подтверждение fresh-task
restoration. Secrets/network/repository membership не менялись. Два tracked
onboarding PNG, перезаписанные собственным E2E, восстановлены и не входят в PR.

## 2026-10-18 — #283 merged по разрешению; первый Admin tenant customer read

Владелец отдельно разрешил «merge #283 и существующий автодеплой Telegram/VK».
После свежей проверки head 472837a / обоих green checks PR #283 переведён из
Draft и squash merged с match-head-commit. Main: abbe089490aafd7984de402c4f80c243bcdafee4.
Release workflow 39138360840 SUCCESS: exact commit deploy обоих сервисов,
public/account/signed-session probes прошли. VK parity 39138360836 SUCCESS.
Версию размещённого Admin сайта этот Telegram/VK workflow не подтверждает.
Repair/unify DB steps skipped по прежним условиям. CI/Railway settings/keys и
устройства вручную не менялись. Разрешение относится только к #283.

Новая ветка spaceverse/crm-tenant-reader-20261018 от этого main. Первый
самодостаточный шаг — default-off GET diagnostic
`/api/admin/onboarding/drafts/:draftId/crm/customers/:userId`, а не готовая
CRM/активация. При исследовании адаптера подтверждено: прежний runtime source
принимает только prepared/inactive scope, а обычный venue resolver — только
active. Нельзя соединить их снятием одной проверки: поэтому пока используется
существующий draft route/access и честный runtimeStatus=not_provisioned.

tenant-crm-read.ts композирует исходный customer-wallet-repository.js,
loadOwnedOnboardingRuntimeSource и прежний target registry. Новых моделей,
миграций, target DML и fallback в ПИВНИК нет. Source и grants проверяются до
и после target read; запрещены client-supplied company/venue/runtime/credentials.
Target transaction REPEATABLE READ READ ONLY, SQL repository повторно проверяет
exact binding + ownership. Успешное чтение оставляет scoped metadata audit без
имени/баланса; ошибка аудита fail-closed. Лимит 30/min/actor. Flag
ADMIN_ENABLE_TENANT_CRM_READS default false, при opt-in startup валидирует
registry. Для чтения PII нужен owner/manager; viewer/trusted без grant запрещены.
Wallet null / balance "0" / bigint decimal string различаются.

Добавлена .d.ts для существующего shared repository и её COPY в Dockerfile:
JS уже попадал в image через прежний COPY *.js; без декларации новая API
сборка внутри image не разрешила бы TypeScript import. CI workflow и runtime
JS ПИВНИКА не меняются. Runbook описывает реальный contract v1/flags/errors,
ограничения и тестовый сценарий; MODULE-MAP обновлён.

Первые signed HTTP/PGlite tests: 14 passed / 1 failed из-за POST без Origin
(ожидали method 405, получили штатный Origin 403). Запрос исправлен, защита
не ослаблялась. Расширенный focused прогон: 18 passed; затем добавлен второй
вариант misbound target и явная проверка отсутствия DSN в ошибке.

Первый полный root прогон ошибочно был после слишком раннего восстановления
generated outputs: 603 passed / 19 failed. Это ошибка порядка моей проверки,
не основание менять root tests/исходники. Повторные materialize ×2 подтверждают
идемпотентность; generated state оставлен на время тестов. Отдельный прежний
diff 7 files / 365 insertions / 78 deletions сохранён с hashes/backups в
/tmp/spaceverse-crm-reader-20261018/gates; перед commit outputs будут восстановлены.

Следующие блокеры остаются: список/поиск и UI сторонней CRM, жизненный цикл
активации, официальный Market/license contract, native PG/TLS и production
readiness. Для тысяч клиентов текущий onboarding registry max=200 и по два
соединения на runtime требуют отдельного bounded-pool/capacity решения;
это зафиксировано, но не расширяет текущую реализацию. AI/API моделей,
кассы/Маркет, новые production env/settings и реальные данные не подключались.

Итоговые проверки этой ветки (логи /tmp/spaceverse-crm-reader-20261018/gates):

- materialize ×2 побайтово идемпотентен; 7 generated outputs восстановлены
  только после проверок с SHA-256 сверкой backups/current; generated diff в PR нет;
- `node --test --test-concurrency=2`: 622 passed / 0 failed/skipped;
- `npm run check`: exit 0; root/Business `npm audit --cache /tmp/spaceverse-npm-cache`: 0 vulnerabilities;
- Business `npm test -- --maxWorkers=1`: 291 passed / 20 прежних PostgreSQL skipped,
  в том числе 19 новых signed HTTP/PGlite tests; root и Business выполнялись последовательно;
- Business `npm run typecheck`, `npm run build`: exit 0, прежний Vite chunk warning;
- ESLint изменённых server/config/router/new service/new tests: exit 0;
- `node /tmp/spaceverse-crm-reader-20261018/compiled-smoke.mjs`: compiled API import
  и default-off 403 PASS, без запросов к БД;
- Playwright `--config=playwright.evotor.config.ts --workers=2`: 12 passed;
  `npm run test:e2e:onboarding`: 4 passed; использован
  PLAYWRIGHT_BROWSERS_PATH=/tmp/spaceverse-playwright. Собственные перезаписанные
  onboarding PNG восстановлены; browser artifacts не входят в PR;
- `git diff --check`: passed. MODULE-MAP и runbook в той же ветке.

Непроверенное: native PostgreSQL/TLS без выделенной тестовой БД, реальный Market/
провайдер/оплата, browser flow нового diagnostic endpoint и коммерческая CRM.
Docker image build не запускался: выполнены npm build + compiled runtime smoke,
это не заменяет проверку release image перед включением функции. Новый код не
merge/deploy, flags в production не включались. Разрешение #283 уже исполнено
и не относится к следующему Draft PR.

## 2026-10-18 — постоянная цель: работать до проверяемой готовности к Маркету

Владелец прямо повторил: «Не останавливайся!! Работай до момента, когда ты
сможешь сказать на 100%: всё, я готов — выкладывай меня на Эватор Маркет».
Это постоянная цель следующих итераций: green foundation PR не считается
завершением SaaS. Продолжать доступную реализацию и проверки по roadmap;
фактическую готовность связывать с полным owner onboarding/CRM/POS/license
сценарием, эксплуатационными проверками и официальными требованиями, а не
числом тестов. Прежние отдельные запреты merge/deploy, production data/keys/CI
и внешние договоры/модерация сохраняются, пока владелец явно их не изменит.

В рамках существующего #284 закрываются оставленные мной пробелы проверки:
поднят отдельный Docker PostgreSQL 16, только loopback port и собственные
synthetic databases/role; реальные URLs/данные не использовались. Прежние
20 native pg integration tests прошли. Для новых 19 HTTP cases общий seed
вынесен без изменения данных в seedOnboardingFixture; opt-in native backend
создаёт отдельные physical databases для metadata и трёх target runtime,
пиннит pg client на транзакцию и проверяет SHOW transaction_read_only=on.
Native URL допускается только с local host/test database prefix/crm_fixture.
Fixture databases сохраняются для инспекции; чужие данные не удаляются.

Первый Docker build был заблокирован read-only buildx cache; BUILDX_CONFIG
перенесён в writable /tmp, DOCKER_CONFIG/auth/proxy не менялись. Временный
verification Dockerfile добавляет только session CA secret mount для npm ci
(strict-ssl=true) и build ARG VITEST_MAX_WORKERS. Прежний default-parallel
прогон дал 3 существующих 5000ms timeout в provisioning tests; повтор с
поддерживаемым VITEST_MAX_WORKERS=1 выполняет все прежние assertions/timeouts.
Production Dockerfile/CI test commands ради проверки не меняются. Полные
результаты и image smoke фиксируются после завершения.

Уточнение сборки после воспроизведения timeout: в production Dockerfile
добавлен build-only `ARG VITEST_MAX_WORKERS=1`, чтобы штатный build не зависел
от скрытой локальной настройки concurrency. Literal test commands, assertions,
5000ms timeouts и CI workflow не меняются; ARG не попадает в runtime ENV.
Временный Dockerfile теперь добавляет только session CA mount к npm ci.
Первый успешный image sha256:4b6b0d9e5e43677bf2d088b0c0dced663ce9b5e42d462f4f74dd12bfc5170247:
typecheck/lint, 291 passed +20 native skipped, security subset 170 passed,
build passed. Исходники для финальной повторной image сборки сверены с
веткой после восстановления семи generated outputs, не с посторонним diff.

Реальный production-mode image smoke с synthetic PostgreSQL прошёл в двух
контейнерах: default-off 403 после настоящего login; opt-in с реальным registry,
тремя physical target DB, company/venue/manager boundary, wallet null/zero/bigint,
scope/POST refusal. HTML/health и secure HttpOnly cookie проверены. API-контейнеры
после smoke остановлены, test PostgreSQL оставлен для повторяемых проверок;
нет production deploy, реальных accounts/keys/POS/API модели. Script/logs в
/tmp/spaceverse-crm-release-verification-20261018. Параллельный host PGlite
focused run во время Docker дал один прежний provisioning timeout; после
завершения Docker изолированный повтор тех же 35 cases — 35 passed.

Полный Business запуск с обеими isolated native test URL: **311 passed / 0
skipped**, 32 suites passed. Ранее пропущенные 20 теперь выполнены, а новые
19 дополнительно используют pg-driver/pinned transactions. В GitHub CI без
включения test URL прежние 20 остаются skipped; настройки CI не менялись.
Повторные root tests после materialize ×2: 622 passed / 0 failed/skipped.
Дополнительный runtime-manifest root suite проверяется после Docker ARG change.
Внешний DB TLS/CA, реальный Маркет/касса/подписка и browser UI нового API
по-прежнему не подтверждены; эти результаты не объявляют CRM коммерчески готовой.

Итог второй проверки #284: финальный image
sha256:0235d39b9baa80c538a2c800f3c1f0860b21f06eb2ddccc3e4b94b4b4ee10c7b
с production Dockerfile `ARG VITEST_MAX_WORKERS=1` (без CLI override) собран:
typecheck/lint, 291 passed +20 native skipped, 170 security passed, build
успешны. Для proxy trust добавлен только временный CA secret mount; CA secret
проверенно отсутствует в runtime image. Повторный real-image startup/login/
default-off и opt-in/native-target HTTP smoke — оба exit 0, API-контейнеры
остановлены. Postgres fixture container остаётся локальным, 127.0.0.1 port.

Перед обновлением PR: root 622/0; отдельный root runtime-manifest suite 10/0
после Docker ARG change; materialize ×2 idempotent, 7 generated outputs
восстановлены по SHA-256; full native Business 311/0 skipped; root check,
root/Business audit (0 vulnerabilities), changed fixture ESLint — exit 0;
Playwright 12 + onboarding 4 passed. Свежие logs/gates в
/tmp/spaceverse-crm-release-verification-20261018; повторно перезаписанные
собственным E2E onboarding PNG восстановлены. `git diff --check` passed.

### 2026-10-18 — следующий срез CRM, отдельная локальная ветка

`spaceverse/crm-directory-20261018`, основана на head #284. Сам #284 остаётся
Draft `9f34d2d1f40b448fee73fb6ef9228bc650018f6f`; оба GitHub checks SUCCESS,
merge не выполнен: отдельное разрешение владельца ещё ожидается. Второй PR
не открыт, текущий #284 новым scope не расширялся. Локальная работа продолжается.

Сделано: коллекция клиентов с буквальным поиском и серверной пагинацией;
общий binding CTE с исходным wallet repository; общий verified-source/read-only/
audit adapter, 5s statement timeout, прежний actor rate limit. Список, поиск,
обновление и карточка встроены в существующий VenueOnboarding, включаются
только прежним default-off CRM flag через session capability и owner/manager
access. Нет новых tenant-моделей, миграций, активированных точек или касс.
UI не предлагает функции Telegram/VK; источники компаний/точек не смешиваются.

Лично выполнено на этой ветке:
- materialize ×2: idempotent. Чистый materialize вновь меняет 7 прежних файлов,
  включая server.js, universal-server.js, app.js. Patch и SHA-256 до/после в
  /tmp/spaceverse-crm-directory-verification-20261018; восстановлены ровно эти
  собственные generated outputs, каждый hash совпал. Патч-цепочка не менялась.
- node --test: **625 passed, 0 failed/skipped**; npm run check, npm audit и
  npm audit --omit=dev --audit-level=high — exit 0, vulnerabilities 0.
- npm test -- --maxWorkers=1 с двумя локальными native PG test URL:
  **322 passed, 0 skipped**, 32 suites. Из них 30 signed-HTTP CRM tests:
  350 matching клиентов без truncation/дубликатов, literal Cyrillic/%/_ search,
  null/0/bigint, две компании/две точки, revoked grant/manifest race,
  чужая binding, закрытый audit failure, request scope и rate limit.
- npx playwright test -c playwright.tenant-crm.config.ts на собственном
  PostgreSQL: **6 passed**, desktop/mobile, built App + signed login + настоящий
  frozen registry/pg pools/SQL. Поиск, страницы, точный баланс, смена точки и
  аккаунта, задержанный настоящий HTTP-ответ. API/SQL не подменены.
- SPACEVERSE_E2E_CRM_READS=false с той же командой: **2 passed**, desktop/mobile;
  UI отсутствует, автоматического чтения нет, серверный endpoint даёт 403.
- changed TS/TSX/E2E files ESLint — exit 0. Общая image сборка/проверки следующего
  среза продолжаются; результат image #284 нельзя приписывать новой ветке.

Неудачные попытки не скрыты: первая E2E fixture пыталась менять frozen registry
и была отклонена. Исправлена на отдельный seed process и настоящий реестр.
Следующий startup поймал ошибку trailing slash в test-only static root (404);
исправлено path.resolve. Два E2E затем ждали скрытую кнопку logout: исправлен
сценарий открытия штатного profile menu; добавлены недостающие synthetic
metadata tables для platform summary. После исправлений все 6+2 прошли.
Production код реестра/меню/схемы ради тестов не менялся, assertions не ослаблены.

Осталось: отдельный PR этого среза после разрешённого merge #284; активация
canonical venue без обхода текущего prepared-only guard; полный самостоятельный
путь установки/лицензии/провайдера, backup/restore/TLS/load gates и Market
модерация. Эти проверки не означают готовность коммерческого релиза.

Финальная проверка локального directory-среза: Docker image
`sha256:d1e9dd6365cd041ba35ebbf4c0b38fffe6d66c9138009d98b493b9e9c4254cd7`
собран с текущим production Dockerfile (только временный public CA secret mount
для npm ci, strict TLS). Внутри typecheck/lint, **302 passed +20 native skipped**,
security **170 passed**, build — exit 0. Отдельный native full suite выше выполняет
все **322 без skip**. Real-image production-mode startup/login/default-off и
opt-in collection/detail smoke с настоящим registry/PG — оба exit 0: 350 matching
клиентов четырьмя страницами, literal search, точные отдельные балансы, manager/
company/venue boundaries, 0/null/bigint и запрет scope. Проверено отсутствие
build CA secret и build-only worker ENV в runtime image. Собственные image API
containers остановлены; локальный test PostgreSQL сохранён.

В финальные 6 native built-panel E2E добавлен транспортный сбой обновления:
старые данные очищаются, ошибка не становится пустым успешным списком,
повторное обновление восстанавливает чтение. Первая попытка вынести это в
дополнительные независимые E2E честно упёрлась в действующий login rate limit
6/15min на fixture root. Проверка объединена с тем же пользовательским сценарием;
лимиты не отключались и не ослаблялись. Повтор: **6 passed**, disabled suite
**2 passed**; прежние cash/CRM scope E2E **12 passed**, onboarding **4 passed**.
Последние ESLint и git diff --check — exit 0; собственные перезаписанные PNG
восстановлены байтово. Все логи в /tmp/spaceverse-crm-directory-verification-20261018.

Cloud setup: helper /workspace/spaceverse-dev-tools/start-native-postgres.py
проверен дважды, реальный SELECT 1 прошёл. Обновлён start_skill в черновике
настроек среды; install_script/network/credentials не менялись. Для будущего
snapshot пользователь должен сохранить и опубликовать настройки среды;
восстановление в новой задаче ещё не проверено, это не production publication.

Подготовлена отдельная техническая записка следующего activation-среза вне
репозитория, чтобы не расширять этот change. Официальные public Evotor SDK
обновлялись в 2018; архив documentation-api — 2017. Они не подтверждают
актуальный install/subscription/revoke contract 2026 и не снимают Market gate.

### 2026-10-18 — готовность именно CRM-сайта, следующая локальная итерация

Ветка `spaceverse/crm-readiness-20261018` поверх локального directory-коммита
`3a18a17`. #284 не изменён и не объединён; единственный открытый Draft, свежие
GitHub checks SUCCESS, head 9f34d2d. Отдельный merge approval ещё ожидается.
Также запрошены наличие зарегистрированного SPACEVERSE app, App ID и актуальный
Market contract; секреты в чат не запрашиваются.

Реализованы GET /api/admin/onboarding/drafts/:id/crm/readiness и блок
«Что осталось для запуска CRM» внутри существующего мастера. Используются
тот же default-off flag, owner/manager access, frozen source, target registry,
SQL ownership boundary, read-only snapshot, 5s timeout, общий actor rate limit
и обязательный audit. Нет новой tenant-модели, миграций или изменений active
flags. Подписка остаётся not_configured, запуск pending/activationAllowed=false:
текущий код не активирует venue и не подменяет отсутствующий Market adapter.

Клиентский источник проверяется настоящим SQL; count=0 с верной binding —
доступная пустая база. Ошибка источника не возвращает успешный count=0.
PII/кошельки/отчёт/credentials в readiness payload не выдаются. Состояние кассы
читается через прежний getOnboardingPosProxy с проверкой encrypted secret;
это last_saved_verification, не новый сетевой вызов. Свежий active дополнительно
требует confirmed, available report (допускает нули), свежие check/device-event
timestamps; >5 минут в прошлом, >5 секунд в будущем и неполный report не
становятся успехом. Активная касса сама по себе не активирует CRM.

Лично выполнено: focused HTTP+rules 51 passed (39+12). HTTP проверяет real signed
session/SQL/шифрование через существующие endpoints; synthetic stored provider
evidence помечено как fixture внешней границы, не как реальная касса.
Новые built-panel native E2E 6 + disabled 2 passed. Полные повторные root
materialize ×2 idempotent; **625 passed /0 skipped**, check/audit/production audit
exit 0. Все 7 известных generated outputs, включая server.js/universal-server.js/
app.js, сохранены в proof и восстановлены с SHA-256. Патч-цепочка не менялась.
Полный Business native **343 passed /0 skipped**, 33 suites; typecheck/lint/build
и оба Business audit exit 0, vulnerabilities 0. Дополнительные browser assertions
на очистку readiness при смене точки/задержке и отдельная image сборка выполняются;
старый image directory не объявляется image нового среза.

Контракт: ops/SPACEVERSE-CRM-READINESS-RUNBOOK.md; карта модулей обновлена.
Логи: /tmp/spaceverse-crm-readiness-verification-20261018.

Финал readiness-среза: image
`sha256:13cb7ecbd2e5a8b7b8089d7aa9b05ec998343b3ccfb98ea128a20609be599c54`
собран. Внутри typecheck/lint, **323 passed +20 native skipped**, security
**170 passed**, build — exit 0. Затем полный host/native повтор **343 passed,
0 skipped** и built-panel native E2E **6 passed** на последнем коде. Disabled
browser **2 passed**, прежние cash/CRM **12 passed**, onboarding **4 passed**.
Границы source/company/venue/account, задержанный readiness/card response и
пустые/ошибочные состояния проверены на телефоне/компьютере. Freshness использует
общую POS_EVENT_FRESH_MS константу существующего proxy, не второй контракт.

Production-mode real-image HTTP smoke обоих режимов (disabled/enabled) —
exit 0: startup/login, настоящий pg registry и три target DB, directory +
readiness, точные scoped counts, pending подписка/активация, запрет client
license/status/scope/POST. Readiness не возвращает PII/кошельки/device secrets.
CA build secret и worker ARG в runtime image отсутствуют. Собственные image
API containers остановлены; test PG оставлен. Никаких live provider/касса/Market
или production deploy эти проверки не выполняли.

Directory-коммит **3a18a17045f4041c507c0be40a5af9b498c7915d** отправлен в
`origin/spaceverse/crm-directory-20261018` после своих gates. Это сохранение
проверенного кода в отдельной ветке; второго PR нет. Проверены существующие
workflow triggers: этот branch push не запускает main production deploy;
CI/workflow files не менялись. Readiness сохраняется отдельным следующим
коммитом/веткой по тому же правилу. По свежему gh pr list единственный открытый
SPACEVERSE Draft — **#284**; merge и новая публикация не выполняются без ответа
на уже заданный вопрос владельцу.

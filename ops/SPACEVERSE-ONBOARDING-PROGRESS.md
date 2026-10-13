# SPACEVERSE — мастер подключения заведений

## Контрольная точка

- Ветка: `spaceverse/venue-onboarding`; один связанный draft PR #273, открыт; reviews/threads отсутствуют. Mergeability перепроверять после публикации нового HEAD.
- Проверенный base перед изменением: `aa07f7ed40fcf74e4720f089910761e89b64648d` (main, повторно получен 2026-10-13).
- Опубликованный implementation commit runtime scope/context: `e0a23879b1b4b70fc1a1b716bd8fb8da19258c12`, tree `d01e7a4d22c6eb5bf65fc8af474ee05d7e5ad2e8`. Текущий docs HEAD нужно читать из GitHub/`git rev-parse`; проверенная реализация остаётся на этом tree.
- Связанный PR искать по head `spaceverse/venue-onboarding`; его CI должен соответствовать текущему опубликованному SHA, а не старому прогону.
- Текущий HEAD нужно читать из GitHub/`git rev-parse HEAD`, не считать этот исходный SHA актуальным main.
- Основной checkout `verify/trusted-director-release-20261011` с чужими изменениями сохранён. Работа идёт в отдельном worktree.
- Перед продолжением проверить свежий main, PR, CI и пересечения с «SPACEVERSE Business — развитие». Не создавать вторую ветку/дубликат PR.

## Цель и этапы

1. **Данные заведения, серверный черновик, повторное открытие** — реализовано и проверено в изолированном окружении.
2. **Принадлежность tenant и конфигурация guest-приложения** — серверный blueprint, стабильный tenant ID, канонические неактивные company/venue и runtime manifest v2 реализованы. Manifest получает company/venue только из сохранённого scope; выделенная БД обязана подтвердить те же ID и checksum. Первый read-only адаптер операций принимает только проверенный server context. Текущий ПИВНИК-специфичный runtime намеренно отказывает tenant-запуску; customer/wallet и write repositories ещё не переведены и доступа к историческим данным ПИВНИКА нет.
3. **Зашифрованные подключения и реальные проверки Telegram/VK/Эвотора** — предстоит.
4. **Возобновляемое создание ресурсов из того же релизного артефакта** — предстоит.
5. **Приглашения и гибкие права** — предстоит.
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
- `GET/PUT /api/admin/onboarding/drafts/:id/scope` — реальный третий шаг мастера. PUT принимает только точные ревизии сохранённых draft/application, блокирует draft транзакционно и один раз резервирует канонические ID. Для новой организации создаются `companies(active=false)` и `venues(active=false)`; для существующей компании создаётся только неактивное venue.
- Scope, company, venue и audit фиксируются одной транзакцией. Потерянный ответ безопасно повторяется с теми же ревизиями; блокировка draft и ограничения PK/UNIQUE закрывают путь к дубликату. Ошибка аудита откатывает обе канонические строки. После подготовки draft/application заморожены, чтобы сохранённый scope не расходился с исходными данными. PGlite проверяет replay/double-click, но реальная межсоединительная PostgreSQL concurrency остаётся для integration environment.
- Обычный tenant resolver требует `company.active=true AND venue.active=true`, поэтому даже SUPER_ADMIN, owner и trusted не могут открыть подготовленное venue через прямой рабочий API. `admin_company_access`, сотрудники, пароли, клиенты, кошельки, операции и provider connections не создаются и не меняются.
- UI показывает канонические company/venue ID и честный статус «Подготовлено · выключено». Несохранённые изменения блокируют подготовку; после неё формы заблокированы. Reload повторно читает scope с сервера, browser storage не используется.

## Включение в изолированном окружении

- Additive migrations: `admin-platform/admin-migrations/004_onboarding_drafts.sql`, `005_onboarding_app_config.sql` и `006_onboarding_scope.sql`. Нет запуска из `server/index.ts` и нет изменения исторических миграций. 005 применяется после 004; 006 — после обеих и создаёт только таблицу связи scope, без DML. Само выделение неактивных company/venue выполняет защищённый API после явного действия.
- Migrations 017 и 018 не входят в automatic startup allowlist. 018 добавляет к будущей binding-таблице только company/venue ID и проверки формата, не вставляя и не изменяя binding-строки. Обе можно применять только вручную к новой выделенной тестовой БД; в общей исторической БД ПИВНИКА этот шаг не нужен и не разрешён.
- Только после подготовки изолированной metadata-БД: `ADMIN_ENABLE_WRITES=true` и `ADMIN_ENABLE_ONBOARDING_DRAFTS=true`. Второй флаг выключен по умолчанию. Без таблицы API возвращает `ONBOARDING_NOT_READY`, ничего не создаёт.
- `SPACEVERSE_RUNTIME_MODE=tenant` и `SPACEVERSE_RUNTIME_MANIFEST_JSON` предназначены для будущего provisioner. Сейчас их установка намеренно не запускает приложение; до завершения tenant-aware runtime их нельзя добавлять в действующие Railway-сервисы.
- Production БД, Railway env, секреты, реальные сообщения, webhook, main и действующие приложения не изменялись.
- При откате выключить флаг; сохранённые черновики оставить. Удаление таблицы не требуется.

## Проверки этой итерации

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
- Railway повторно проверен только на чтение: production-сервис `admin-pilot` активен на ветке main, staged-изменений нет; последний успешный deployment использует старый SHA `5dd9201…` (2026-10-12 06:05 UTC), onboarding-флаг и новые runtime env отсутствуют. Этот PR в production не развёрнут.

## Следующий безопасный шаг

Продолжить этап 2 следующим узким срезом: провести verified runtime context через scoped transaction write boundary и запретить tenant-mode операциям любой legacy fallback или request-supplied scope. Customer/wallet reads пока не включать: у исторических `users`/`wallets` нет доказанной tenant-принадлежности. Проверить повтор записи, cross-tenant/location отказ и два venue одной company на ручной migration 009, не включая tenant startup и не создавая production-БД. Только после устранения всех ПИВНИК-специфичных fallback можно разрешать manifest status выше `not_provisioned`; ключи провайдеров до готового шифрования не принимать.

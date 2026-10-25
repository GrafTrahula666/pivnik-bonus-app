# Admin Pilot — облачное приложение Эвотор.Маркета

Обновлено 25 октября 2026. Реализация: `admin-platform/server/evotor-market.ts`,
ручные Admin migrations `018_evotor_market_inbox.sql`, затем
`019_evotor_market_reconciliation.sql`.

## Выбранная архитектура и фактическая граница

Существующий веб-сервис остаётся отдельным Admin runtime. Облачный вариант
публикации не требует APK: в [официальном quick start](https://developer.evotor.ru/docs/doc_evotor_api_introduction.html)
признак «Приложение с APK» относится к установке программы на терминал.
Для CRM используются собственный вход на сайте и серверные callback Маркета.
Товароучёт, склад и кассовая программа не добавляются.

Реализован **durable callback inbox**, а не завершённая платная активация SaaS.
Он не создаёт canonical company/venue, не присваивает компанию по `userId`,
не выдаёт browser session или роль, не включает CRM и не отправляет запросы
Эвотору. Провайдерская личность в inbox не является вторым tenant registry.
Существующие ACL/tenant guards остаются обязательными.

Состояние `active` в таблице подписок — только проекция полученных событий.
Его запрещено использовать как разрешение работы CRM или AI. Не завершены:
подтверждённая связь provider user/store → canonical company/venue,
reconciliation через разрешённый API/кабинет, утверждённые plan/addon rights,
контроль terminal allocations и серверный license authorizer для всех API.
`tenant-crm-readiness.ts` сохраняет честный `market_contract_not_configured`.

## Официальные контракты

Содержание официальных страниц получено через Exa 23 октября 2026; прямой
HTTP из среды возвращает 403. Источники и проверка в реальном кабинете — разные
виды доказательств. Callback тесты ниже локальные, не установка из Маркета.

| Callback | Принимаемый контракт | Успех |
|---|---|---|
| `POST /api/v1/user/token` | JSON `{userId, token}`; token — доступ пользователя к Evotor Cloud | Пустой 200 после COMMIT |
| `POST /api/v1/installation/event` | `id` UUID4, epoch milliseconds `timestamp` (число или decimal string), `version:2`, `type`, `data:{productId,userId}` | Пустой 200 после COMMIT |
| `POST /api/v1/subscription/event` | UUID4 `subscriptionId/productId`, `userId`, ISO8601 timestamp с offset, integer sequence ≥1, точный `type` и условные поля | Пустой 200 после COMMIT |

Официальные схемы: [user/token](https://developer.evotor.ru/docs/rest_api_webhooks_post_user_token.html),
[installation/event](https://developer.evotor.ru/docs/rest_api_webhooks_post_installation_event.html),
[subscription/event](https://developer.evotor.ru/docs/rest_api_webhooks_post_subscription_event.html).

Типы установки: `ApplicationInstalled`, `ApplicationUninstalled`.
Типы подписки: `SubscriptionCreated`, `SubscriptionActivated`,
`SubscriptionRenewed`, `SubscriptionTermsChanged`,
`SubscriptionTerminationRequested`, `SubscriptionTerminated`, `AddonsUpdated`.
Неизвестные поля/версии/types отвергаются, а не исполняются по догадке.
Created требует `planId` и `trialPeriodDuration` в документированном виде `PnDT`;
Activated/Renewed требуют nextBillingDate; AddonsUpdated требует addons.
Дата без timezone/несуществующий календарный день недопустимы.

`/user/create` и `/user/verify` относятся к регистрации/входу через аккаунт
партнёра в интерфейсе покупки Эвотора. Они не включены в выбранный independent
website login. **Не настраивать их URL в кабинете как работающие**.
Если Маркет требует именно этот account flow, реализовать его отдельно с
проверкой существующего аккаунта, текущих owner grants и защищённой привязкой;
email/телефон из непроверенного callback не означают право на компанию.
Источники: [cloud integration](https://developer.evotor.ru/docs/doc_cloud_systems_integration.html),
[create](https://developer.evotor.ru/docs/rest_api_webhooks_post_user_create.html),
[verify](https://developer.evotor.ru/docs/rest_api_webhooks_post_user_verify.html).

## Авторизация: противоречие документов и release gate

[Общий документ](https://developer.evotor.ru/docs/doc_evotor_api_authorization.html)
указывает app-level service token для subscription/install notifications;
конкретные две REST-страницы называют user-level partner token.
Этот receiver поддерживает **только явно настроенный app-level Authorization**,
по общему документу. Автоматического принятия нескольких классов ключей нет.
Cloud API token, device key, session cookie и CSRF token не подходят.
`user/token` по официальной схеме также использует app-level credential.

До выпуска Эвотор должен подтвердить эту конфигурацию и прислать реальные
тестовые события. Если test contour использует per-user partner token, нужен
другой явно настроенный adapter с криптографической привязкой token→userId;
ослаблять текущую проверку нельзя.

Срок retry расходится: subscription reference — два дня, overview — три;
installation reference — три дня. [Billing overview](https://developer.evotor.ru/docs/doc_about_billing.html)
не согласуется с endpoint-specific ack semantics.
Receiver отвечает 200 только после сохранения транзакции и допускает повторы
независимо от конкретного retry horizon. Реальный порядок/повторы проверить
в тестовом приложении; не считать неприсланное событие отсутствующим действием.

## Локальная конфигурация

| Переменная | Назначение |
|---|---|
| `ADMIN_ENABLE_EVOTOR_MARKET_WEBHOOKS` | Только точное `true` включает; default false |
| `ADMIN_EVOTOR_MARKET_PRODUCT_ID` | UUID4 тестового приложения из кабинета |
| `ADMIN_EVOTOR_MARKET_AUTHORIZATION` | Полная строка `Bearer …` или `Basic …`, ≥40 символов; ввод только в защищённых настройках |
| `ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID` | Existing active key ID для AES-GCM |
| `ADMIN_ONBOARDING_SECRET_KEYRING` | Existing protected keyring; base64 32-byte AES keys |
| `ADMIN_DATABASE_URL` | Отдельная Admin metadata DB; не guest/financial database |

Никакие реальные значения не записываются в Git, карточку, URL, тесты или чат.
Примеры согласованы в `.env.example`, `env.example`, `.env.admin.example`.
Миграции не запускаются на startup. Migrations 018/019 additive/manual; отдельно
review schema/grants/backup до разрешённого применения. Root migration007 не
меняется. Таблицы не дают доступ к `users`, `wallets`, `transactions`.

Mount расположен до browser router в Admin `index.ts`; callbacks не требуют
Origin/CSRF, поскольку используют app authentication. Существующие браузерные
роуты по-прежнему проходят Origin/session/CSRF. Root `server.js` и
`universal-server.js` не обслуживают эти callback и не изменяются.
При выключении exact callback paths возвращают 404; чужие `/api/*` — прежний
reject. Для включённого receiver: 401 bad auth, 400 bad schema/product,
405 wrong method, 409 conflicting replay/user binding, 413 body >32KiB,
503 storage/config failure. Ответы не содержат payload, токен или SQL exception.

## Надёжность и ограничения состояния

- Ключ event: `installation:<id>` или `subscription:<subscriptionId>:<sequence>`.
  Нормализованный JSON canonicalized и SHA256 защищает exact retry; изменение
  payload под тем же ключом возвращает 409 **после COMMIT**: оригинал сохраняется,
  `admin_evotor_market_conflicts` хранит только event key и изменённый SHA256.
  У исходного provider user и subscription устанавливается sticky
  `reconciliation_required`. Подмена userId не переносит hold на чужую личность.
  Повтор/последующее событие/новый token/reinstall не снимают hold. API сброса нет;
  нужен отдельный проверенный reconciler. Ошибка сохранения hold даёт503.
  До 019 исторические отклонённые конфликты не сохранялись: новая миграция не
  восстанавливает отсутствующие свидетельства задним числом.
- Row lock пользователя сериализует события/rotation; subscription lock и
  проверка product/user не позволяют переиспользовать чужую подписку.
  **Отдельный конфликт:** если пришёл новый sequence для уже существующей
  subscription, но с другим provider userId/productId, событие сохраняется как
  свидетельство, исходная subscription атомарно получает sticky
  `reconciliation_required=true` и `review_required`, ответ 409 только после
  COMMIT. Ошибка COMMIT даёт 503 и откат; повтор не очищает hold. Исходный
  provider user в этом пути не блокируется дополнительно: чужая user row уже
  удерживается транзакцией, а захват второй user row после subscription lock
  создаёт риск deadlock. Поэтому будущий license gate ОБЯЗАН проверять hold
  конкретной subscription, а не только user-level hold. Ручная сверка обязательна.
- Проекция применяет только contiguous prefix от sequence1. Gap сохраняется
  явно; заполнение gap обрабатывает и backlog >1000 за несколько batches.
- Uninstall не стирает записи/клиентов. Более старый install игнорируется;
  противоречие установки в одно время даёт `ambiguous`. Installation timestamps
  разных событий без гарантированного порядка остаются provider-test gate.
- `TerminationRequested` после `Terminated` даёт `review_required`, а не resumable
  состояние: следующий Renewed/Activated не восстанавливает эту подписку.
- `TerminationRequested` отличается от `Terminated` и допускает renewal.
  Реальный paid-through доступ требует отдельной согласованной политики.
  Смена plan/addons требует review; неизвестная AI опция не получает доступ.
- Created/trial не является подтверждённой оплатой; one-off/free/trial access
  policy пока не реализована. Не назначать nextBillingDate самостоятельно.
- Token callback не имеет event ID/версии. Хранится последний **доставленный**
  токен, а не доказанно последний выданный; повтор того же токена идемпотентен,
  другой token повышает revision. Доставка старого token после rotation не
  различима по этому контракту. До использования нужны live API verification
  и reconciliation; сейчас token consumer отсутствует. AAD включает product/user.
- Будущий expiry/license authorizer обязан учитывать installation/revocation,
  sequence gaps/conflicts и ОБА reconciliation_required (user/subscription), provider freshness, exact tenant/store allocation,
  paid period, признанный plan/addon и account/grant revocation. Никакого
  автоматического согласия на AI или paid provider calls из inbox нет.

## Верификация

```bash
cd admin-platform
npx vitest run server/tests/evotor-market.spec.ts server/tests/login-rate-limit.spec.ts
npm run build
npm run lint
```

`evotor-market.spec.ts` выполняет настоящий HTTP handler и SQL manual migration
в disposable PGlite; native fixture выбирается защищённой переменной
`SPACEVERSE_TEST_NATIVE_POSTGRES_URL`. Она допускает только loopback,
роль `crm_fixture` и DB name `codex_admin_test*`; создаёт отдельную базу на
сценарий. Нативный прогон использует независимые connections/row locks.
Для полного Business regression дополнительно используется отдельная
`ADMIN_INTEGRATION_TEST_DATABASE_URL` с synthetic DB. Integration suite удаляет
схему только внутри этой disposable test DB; не задавать production URL.
Точные итоги/команды находятся в `ADMIN-PILOT-MARKET-PROGRESS.md`.

Обязательный реальный E2E: install test user → token → owner identity binding →
store/terminal permissions → initial SELL/PAYBACK sync → repeated/late/return
documents → activation/renewal → expiry/uninstall/revoke. Проверить реальные
401/402/403/429, pagination, неполную историю и различие unknown/zero.
Приём локального JSON не засчитывается как этот E2E.

## Выключение и выпуск

Для локального/стендового rollback выключить flag и перезапустить разрешённый
стенд. Не удалять таблицы/записи и не откатывать additive migration автоматически.
Production flag/config/deploy разрешаются владельцем отдельно, после готовой
проверки. Merge main также отдельно: существующие workflows могут запускать
production deploy. Нынешний Draft PR не является разрешением на запуск.

## Повторная проверка официальных источников — 25 октября

Официальные endpoint schemas и общий документ авторизации повторно прочитаны
через web retrieval. App/user auth discrepancy сохраняется; app-only gate не
ослабляется. Известен возможный account-link flow через дополнительные поля
[user/verify](https://developer.evotor.ru/docs/rest_api_webhooks_post_user_verify.html),
но callback ещё не реализован: нужны подтверждённые настройки тестового приложения,
одноразовый owner proof и повторная проверка текущих canonical grants. Ни userId,
ни полученный cloud token отдельно не назначают компанию SPACEVERSE.

Будущий license reconciler может изучить официальный
[event stream](https://developer.evotor.ru/docs/rest_events_streaming_api_guide.html)
и [GET events](https://developer.evotor.ru/docs/rest_api_get_events.html).
История начинается с настройки событий версии приложения; этот поток нельзя
выдавать за безусловный current-state oracle или подтверждение полноты старой
подписки. Тарифные права и provider test остаются отдельными gates.

## P0.2: проверка магазинов — отдельный Draft, без включения

`verifyEvotorMarketStores` в `server/evotor-market-stores.ts` реализует bounded
read-only GET, но пока не вызывается runtime. Источники проверены25 октября:
[GET /stores](https://developer.evotor.ru/docs/rest_stores.html) подтверждает
items/id/user_id и paging/next_cursor; [overview](https://developer.evotor.ru/docs/rest_overview.html)
подтверждает Bearer и оба заголовка v2. Cursor — opaque query value на том же
фиксированном host, никогда URL перехода. Требуется HTTP200;206 не считается
полной коллекцией. Сохраняется только минимальная immutable проекция ID/user.

Все страницы проверяются до возврата любого результата. Устанавливаются
защитные **локальные**, не провайдерские лимиты:15s на всю операцию,50 страниц,
5000 магазинов,1MiB/страница и5MiB суммарно. При их превышении результат unavailable,
а не «магазинов нет». Нет автоматических повторов, фоновых calls или обхода TLS.
Чужой user_id, повтор ID/курсора, неверный envelope/JSON/UTF-8/headers, redirect,
401/403/429/ошибка/timeout завершают проверку без частичного подтверждения.
Транспортные ошибки/payload/token не возвращаются вызывающему коду.

Для будущего подключения обязательны одновременно:
1. Проверенный canonical owner/grants и одноразовый account proof, а не userId из формы.
2. Exact product/user/install и отсутствие user/subscription reconciliation holds.
3. Извлечение cloud token только сервером; фиксация revision до GET и повторная
   проверка этой revision, grants и source после GET в атомарной операции binding.
4. Выбор существующего store только из полного проверенного результата; terminal
   permissions/allocations проверяются отдельно. Пустая коллекция не подтверждает
   ownership и не активирует CRM. Лицензия отдельная.

Дополнительно `verifyEvotorMarketStoresAtRevision` требует серверный
`expectedTokenRevision` (положительный safe integer) и async reader текущей
revision из primary Admin DB. До GET и после полного списка сравнивает revision:
отсутствие, отзыв, ротация или ошибка чтения возвращают только
`EVOTOR_MARKET_STORES_TOKEN_REVISION_STALE`, без результатов/секретов.
Проверены тестами preflight rejection, mid-flight revocation, ошибки DB и
валидный двойной read. Это **не** доказательство владельца и не готовый
consumer; после GET binding transaction всё равно обязан повторно проверить
revision, install/holds и canonical grants под актуальными блокировками.
Реальный провайдер не вызывался.

Пока этот consumer не реализован, функция — подготовленный adapter, **не безопасная
каноническая привязка бизнеса целиком**. Настройки кабинета/реальные запросы/DB
binding/активация и финансовые операции в этой итерации не выполнялись.

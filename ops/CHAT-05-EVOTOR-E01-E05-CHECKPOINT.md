# CHAT 05 — Evotor.Market E01–E05 evidence / checkpoint

**Дата сверки:** 2026-11-01 (UTC). **Текущий пункт:** 41 из 41–50, **BLOCKED**, переход к 42 запрещён до закрытия 41.  
**Scope:** только официальные требования, подтверждение тестового контура и журнал доказательств. Никаких live callback, OAuth, кассовых или production-записей.  
**Base main:** `c92ed7cd65f1a96d94363c2b7e212424ab078a73`.  
**Feature branch:** `spaceverse/chat05-evotor-e01-e05-evidence-20261101`.  
**Draft PR:** [#329](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/329), без merge/deploy. **Implementation/docs commit:** `0f951a27167267d54d1c03d882ff1a0d238b9935` (исходный docs commit; точный checkpoint HEAD после этой записи читать из GitHub).  
**Смежные merged PR:** #299 (inbox), #302 (store/owner prerequisites), #312 (license preflight), #296 (CRM bootstrap). Это НЕ доказательство live-работы. #96 остаётся отдельным открытым Draft.

## Матрица E01–E05: официальное описание != проверка приложения

| Gate | Подтверждено официальной публичной документацией | НЕ подтверждено / статус | Следующее необходимое доказательство |
| --- | --- | --- | --- |
| **E01 — издатель и юридические условия** | FAQ портала: для публикации пока требуется юридическое лицо; для облачной интеграции после оформления страницы требуется обратиться к `developer@evotor.ru`. Quick start: создать черновик в кабинете и выбрать Эвотор.Маркет. | **BLOCKED / PARTIAL:** нет подтверждённых для SPACEVERSE издателя, договора/оферты, кабинета, разрешения Эвотора, актуальной редакции коммерческих условий. FAQ не является подписанным договором. | Владелец/юрист: издатель и реквизиты, доступ к кабинету, актуальная оферта/договор, письменное подтверждение cloud integration от Эвотора. Не подписывать и не регистрировать за владельца. |
| **E02 — cloud/no-APK и запуск** | Quick start требует APK-флажок **если приложение устанавливается на терминал**; cloud integration описывает сервис в браузерном ЛК и webhook URL. Можно готовить web/cloud сценарий без обязательного APK. | **PARTIAL:** реальный тип приложения SPACEVERSE, launch URL, callback URL и установка на тестовом аккаунте не проверены. | Скриншоты/экспорт настроек разрешённого черновика без секретов, подтверждённый app type, тестовая установка/открытие. Не делать APK по предположению. |
| **E03 — owner / installation / binding** | Cloud integration перечисляет `/user/create`, `/user/verify`, `/user/token`, `/subscription/event`; installation callback отдельно описан. Общая auth-инструкция требует app-level token для installation/subscription, **но** отдельные API-страницы обоих событий называют user token. | **BLOCKED:** противоречие в официальных документах; нет подлинного тестового события, доказательства owner identity, привязки к canonical company/venue или проверенного `Authorization`. | В разрешённом тестовом аккаунте снять **только обезличенную** схему запроса/тип auth, получить письменное разъяснение Эвотора. До этого не ослаблять app-level verification и не активировать binding. |
| **E04 — scopes** | OAuth guide перечисляет `store:read`, `device:read`, `document:read`, `product:read`, `product.quantity:read` и прочие отдельные права. Для чтения магазинов нужен `store:read`; запись остатков отдельная и не нужна для проверки ownership. | **PARTIAL:** каталог документирован, но реальные выданные scopes, доступность документов/товаров в тестовом контуре, нужный минимум для SPACEVERSE и отдельные согласия не подтверждены. Нет основания запрашивать write. | Утверждённый read-only scope matrix, consent в тестовом аккаунте и 200/403 по GET stores/documents/products, без изменения данных. |
| **E05 — credentials, rotation, revoke** | После установки Эвотор выдаёт cloud token для пары app/user и может доставлять его через `/user/token`; OAuth `authorization_code` обмен на сервере возвращает access/refresh token, документация описывает `refresh_token` grant для web client. | **PARTIAL / BLOCKED:** default-off inbox и unmounted exchange/state/binding есть в коде; нет живого сценария rotation/revoke/uninstall, гарантии порядка доставок, проверенного refresh и runtime revocation для нового tenant. | Разрешённый тестовый install → token → rotate → uninstall → replay, проверка немедленного fail-closed и отсутствия секретов в URL/log/GET. |

## Официальные источники, прочитанные 2026-11-01

1. FAQ: https://developer.evotor.ru/faq/ — юридическое лицо и запрос на облачную интеграцию.
2. Quick start: https://developer.evotor.ru/docs/doc_evotor_api_introduction.html — draft, APK только для терминального приложения, до 5 тестировщиков, тестовая установка.
3. Cloud integration: https://developer.evotor.ru/docs/doc_cloud_systems_integration.html — cloud URL, account flow, subscription.
4. Webhook auth: https://developer.evotor.ru/docs/doc_evotor_api_authorization.html — app-level authorization для install/subscription.
5. Installation callback: https://developer.evotor.ru/docs/rest_api_webhooks_post_installation_event.html — **противоречащий** user-token текст.
6. Subscription callback: https://developer.evotor.ru/docs/rest_api_webhooks_post_subscription_event.html — **противоречащий** user-token текст; также описывает retry **2 суток**.
7. Subscription guide: https://developer.evotor.ru/docs/doc_subscriptions.html — retry **3 суток**; расхождение с API reference требует теста/разъяснения.
8. OAuth guide: https://developer.evotor.ru/docs/rest_oauth20_authorization_guide.html — web client, scopes, authorization_code, token/refresh; пример redirect содержит `code`, **не доказывает echo `state`**.
9. Token webhook: https://developer.evotor.ru/docs/rest_api_webhooks_post_user_token.html — token delivery и app-level Authorization.
10. GET stores: https://developer.evotor.ru/docs/rest_stores.html — список магазинов с cursor; не заменяет независимую owner-сессию.

**Документальные противоречия не разрешены выбором удобной версии.** Реальный provider test и подтверждение от Эвотора обязательны. Никаких токенов, идентификаторов реального клиента, персональных данных или коммерческих секретов здесь нет.

## Инженерный preflight и независимая проверка

- `ops/MODULE-MAP.md` и раздел `Do not break` прочитаны; `ops/EVOTOR-MARKET-REQUIREMENTS.md`, `ops/EVOTOR-MARKET-RUNBOOK.md`, `ops/ADMIN-PILOT-MARKET-PROGRESS.md` сверены. Последний progress содержит **устаревший** checkpoint от 26 октября и сведения о Draft, хотя #299/#302/#312 уже merged; не использовать его как текущий release truth.
- `pivnik-preflight` и его references **не обнаружены** в доступном каталоге skills этого запуска. Инварианты проверены напрямую по актуальному MODULE-MAP, но это не заменяет недоступный skill.
- На main `c92ed7cd...` GitHub combined statuses показывают Railway SUCCESS для `admin-pilot`, `pivnik-vk-test`, `pivnik-bonus-app`. Запрос PR-triggered workflow runs для этого SHA вернул пустой список: **не считать** root tests, native PG, materialize, build или audit выполненными в этом запуске.
- Railway production `content-nature` прочитан **read-only**: `admin-pilot` и основные приложения имеют latest deployment SUCCESS; staged/pending changes нет. Это не provider E2E и не проверка Эвотор.Маркета.
- Локального checkout проекта в этом запуске нет; `npm run materialize` ×2, `node --test`, `npm run check`, `npm audit` **не запускались**. Изменение только документационное, без runtime/DDL/routes/secrets.
- Нет доступа к подтверждённому издательскому тестовому кабинету и согласованному тестовому магазину. Никаких live provider requests или моков, выдаваемых за live, не было.

## Следующий минимальный шаг (остаться на 41)

Получить подтверждение издателя/правил и безопасный доступ к **разрешённому тестовому** кабинету без передачи секретов в Git/чат; запросить у Эвотора письменное разъяснение app-vs-user `Authorization`, retry 2-vs-3 days, поддерживаемый `state` round-trip, перечень минимальных scopes и процедуру rotation/revoke. Затем зафиксировать только проверенные test evidence (редактированные заголовки/коды ответа, без токенов) и обновить E01–E05. Если доступ отсутствует, оставить **BLOCKED** и продолжать безопасную документационную подготовку в этом пункте, не переходить к 42.

**Передача координатору CHAT 01:** только Draft PR, без merge/deploy, production migrations, оплаты, реальной кассы и киоска.


## Продолжение 2026-11-01: test acceptance protocol (следующая ручная итерация 41, НЕ live E2E)

### Прочитан текущий runtime-контракт, не только документация

- \`admin-platform/server/evotor-market.ts\` в \`main\` содержит ровно три обработчика POST: \`/api/v1/user/token\`, \`/api/v1/installation/event\`, \`/api/v1/subscription/event\`. Флаг \`ADMIN_ENABLE_EVOTOR_MARKET_WEBHOOKS\` оставляет их недоступными по умолчанию. При включении все три сравнивают \`req.headers.authorization\` с **одним** серверным \`ADMIN_EVOTOR_MARKET_AUTHORIZATION\`; без совпадения возвращают 401. Это реализация, а НЕ доказательство реального provider credential contract.
- \`/user/token\` сохраняет token только зашифрованным, rotation увеличивает ревизию; install/subscription имеют durable event reconciliation. Коммит подтверждён чтением исходников, но локальный запуск этого кода в текущей итерации не проводился.
- \`evotor-market-oauth-exchange.ts\` требует серверные credentials, точно зарегистрированный HTTPS redirect, \`store:read\` и \`authorization_code\`; остаётся **UNMOUNTED**. \`evotor-market-stores.ts\` выполняет полный ограниченный GET \`/stores\` и сверяет \`user_id\` по каждой записи; также **UNMOUNTED**.
- Сверить ожидаемый вид \`Authorization\` **отдельно для каждого** callback: единая настройка сейчас не гарантирует совместимость с event-specific app/user token. Не встраивать альтернативное принятие любых bearer, не принимать подмену identity из тела.
- Ещё одно нормативное расхождение: \`/subscription/event\` reference указывает retry в течение **двух суток** с прогрессией задержек, а \`doc_subscriptions.html\` говорит о **трёх сутках**. Значит ни верхнюю границу окна повторов, ни отсутствие ретраев нельзя считать известными; durable idempotent обработчик должен сохраняться.

### Приёмка E01–E05 только в разрешённом тестовом кабинете

| Шаг | Безопасная операция | Доказательство, которое можно сохранить без секретов | PASS только если |
| --- | --- | --- | --- |
| **41-A / E01** | Проверить издателя, текущие разрешения cloud-интеграции и действующие условия в кабинете | Идентификатор/тип тестовой версии без личных данных, дата редакции условий, подтверждение доступности интеграции | Подтверждены издатель, применимая оферта/соглашение и разрешение на тест, без предположений |
| **41-B / E02** | Проверить тип cloud/no-APK, настройку launch/Integration URL и тестовую установку | Схема URL/путь без secrets/query, статус установки, отметка времени UTC, какой именно режим/версия | Установка и открытие реально проверены на разрешённой тестовой версии |
| **41-C / E03** | В безопасном тестовом контуре получить по одному provider event для token, install, subscription (если события подписки поддерживаются выбранной схемой биллинга) | Для каждого: route, \`Authorization\` *scheme* (не значение), подтверждённый тип credentials app/user, HTTP status, event type, timestamps, статус записи/reconciliation | Тип credentials установлен независимо для **каждого** callback, валидный event принят, неверный/replay/cross-user запрещены |
| **41-D / E04** | Проверить только разрешённые GET со \`store:read\` и отдельно согласованными \`document:read\`, \`device:read\`, \`product:read\` | Consent/scopes перечислены без токенов; ответ 200/401/403, completeness pagination, подтверждённый owner scope | Реальные granted scopes и доступ к данным каждого нужного типа подтверждены; лишних write scopes нет |
| **41-E / E05** | Разрешённый тест: token delivery → обновление → uninstall → повтор/отзыв; не трогать ПИВНИК или реального клиента | Результат отказа после ревизии/отзыва, номер внутренней ревизии без credential, код состояния без персональных идентификаторов | Отзыв/rotation закрывает доступ в каждый защищённый контур, replay не очищает hold, секреты не попадают в отчёт |

Для тестового OAuth отдельно проверить передачу непредсказуемого одноразового \`state\` на authorize URL и его **точное** возвращение на registered redirect вместе с \`code\`. Если \`state\` не возвращён, изменён или нельзя связать callback с исходной SPACEVERSE owner-сессией, зафиксировать **FAIL/BLOCKED**, не обходить проверку и не включать flow. Это подготовка для последующего пункта 44, **не** его приёмка.

**Санитарные правила:** не отправлять \`Authorization\`, raw token, \`code\`, \`state\`, clientSecret, cookie, реальные userId/storeId или полные тела callback в GitHub/чат/общий лог. Не логировать \`Authorization\` даже при ошибке. Данные собирать только через утверждённый тестовый контур, с секретами в защищённом серверном хранилище; в evidence отчёте оставить только схему заголовка, классификацию credentials, коды ответа и итог. Не включать production webhook ради сбора доказательств.

### Адресный запрос разработчикам Эвотора (черновик, НЕ отправлен)

Адрес из официального FAQ: \`developer@evotor.ru\`.

**Тема:** SPACEVERSE CRM — подтверждение cloud-приложения, авторизации webhook и OAuth в тестовом контуре

> Здравствуйте! Разрабатываем облачную B2B CRM SPACEVERSE для заведений и рассматриваем публикацию в Эвотор.Маркете без APK.
>
> Просим уточнить актуальные правила для разрешённого тестового приложения:
>
> 1. Возможно ли в 2026 году зарегистрировать и протестировать cloud/no-APK интеграцию? Какие требования к издателю, договору/оферте, launch URL и URL callback?
> 2. Какая credential type фактически должна передаваться в \`Authorization\` для \`POST /api/v1/user/token\`, \`POST /api/v1/installation/event\`, \`POST /api/v1/subscription/event\`: токен приложения или токен пользователя? Общая инструкция и справочник install/subscription противоречат друг другу. Используется ли одинаковый токен во всех трёх событиях?
> 3. Какое актуальное окно повторной доставки \`subscription/event\`: два или три дня? Сохраняются ли event/sequence при повторах, есть ли строгая гарантия порядка?
> 4. Поддерживает ли \`https://oauth.evotor.ru/oauth/authorize\` параметр \`state\` и возвращает ли его без изменений на \`registered_redirect_uri\` для web client с \`authorization_code\`?
> 5. Какие минимальные OAuth scopes требуются для чтения магазинов, касс, закрытых чеков и товаров? Какие доступы разрешены для тестового кабинета?
> 6. Как документированно проверять ротацию токена, отзыв установки и отзыв OAuth grants без риска для реального магазина?
>
> Будем благодарны за актуальные ссылки/редакции документов, порядок получения тестового кабинета и допустимый сценарий проверки. Реальные секреты и данные клиентов по электронной почте не передаём.
>
> SPACEVERSE CRM, техническая команда.

### Контроль исполнения этой итерации

- В этой итерации реально загружен установленный \`pivnik-preflight\` и обе обязательные references. Отметка выше о недоступности skill принадлежит **предыдущему запуску** и исторически не исправляется задним числом.
- Прочитан актуальный \`main\` \`ops/MODULE-MAP.md\`, включая \`Do not break\`, исходники трёх соответствующих серверных модулей и действующий checkpoint #329.
- Подтверждён GitHub Actions \`Pivnik release gate\` run \`41266371937\`: **conclusion=success** для предыдущего HEAD Draft #329 \`11dc3e01\`; полный состав jobs/logs отдельно не анализировался, это **не** live Evotor.
- Локального Git checkout нет: materialize×2, \`node --test\`, \`npm run check\`, \`npm audit\`, native PostgreSQL, browser и настоящие test events **лично не запускались**. Этот docs-only diff не требует production migration; результаты CI для **нового** HEAD следует проверить отдельно.
- **Итог: задача 41 по-прежнему BLOCKED.** Внешний provider support/кабинет и реальный проверенный event необходимы. Не менять runtime auth, не merge/deploy и **не переходить к 42**.


## Третья итерация CHAT_05/41 — проверка внешних источников и подготовка запроса (2026-11-01)

**Режим:** отдельная docs-only ветка, Draft #329, не включать реальные OAuth/callback routes. **41 остаётся BLOCKED** из-за отсутствия подтверждённого тестового кабинета, event Authorization и разрешённого live OAuth. Проверка этого шага не заменяет E01–E05 acceptance.

### Дополнительно проверено по актуальным публичным официальным документам

1. [Авторизация входящих вебхуков](https://developer.evotor.ru/docs/doc_evotor_api_authorization.html) различает облачный `X-Authorization` и вебхуки `Authorization`, а также описывает **app-token** для install/subscription. [Схема installation](https://developer.evotor.ru/docs/rest_api_webhooks_post_installation_event.html) и [схема subscription](https://developer.evotor.ru/docs/rest_api_webhooks_post_subscription_event.html) продолжают называть **user-token**. Это контрактное расхождение **не разрешено**. Не делать OR-проверку по любому токену, не отключать строгую проверку входящего события.
2. [Справочник subscription](https://developer.evotor.ru/docs/rest_api_webhooks_post_subscription_event.html) говорит об **2 сутках** повторной доставки, [общий guide подписок](https://developer.evotor.ru/docs/doc_subscriptions.html) говорит о **3 днях**. Единая доказанная граница времени отсутствует, нельзя объявлять ретраи ненужными.
3. [Cloud integration guide](https://developer.evotor.ru/docs/doc_cloud_systems_integration.html) включает сценарии `/api/v1/user/create`, `/api/v1/user/verify`, `/api/v1/user/token`, `/api/v1/subscription/event`. Прочитанный в этой очереди `admin-platform/server/evotor-market.ts` обрабатывает только `user/token`, `installation/event`, `subscription/event` в default-off режиме. **Не установлено**, можно ли выбрать OAuth-only launch без create/verify или требуется отдельный поддерживаемый аккаунтный сценарий. Это вопрос к провайдеру и к пунктам 42–45; **не создавать сейчас** фиктивные create/verify без контрактного подтверждения.
4. [OAuth guide](https://developer.evotor.ru/docs/rest_oauth20_authorization_guide.html) подтверждает серверный web-client `authorization_code`, `refresh_token`, exact `registered_redirect_uri`, но пример редиректа с `code` **не подтверждает возврат `state`**. Ошибка/отсутствие state в live test остаётся deny-by-default.
5. [FAQ](https://developer.evotor.ru/faq/) говорит, что для cloud-интеграции требуется контакт `developer@evotor.ru` и для публикации нужны оформленные издательские права. Эту справку нельзя подменять реальным статусом юридического лица или принятой офертой.

### Действие для получения ответа провайдера

Через подключённый Gmail **создан, но не отправлен** отдельный черновик письма с темой «SPACEVERSE CRM — технические вопросы по авторизации и OAuth облачной интеграции», получатель `developer@evotor.ru`. Он уточняет шесть вопросов: token type для каждого callback, срок retry, OAuth `state`, create/verify vs OAuth-only, минимальные scopes, revoke/rotation в test environment. Ранее существующий юридический черновик **не изменялся**. Дублирующих GitHub PR или automations не создано. Само создание черновика не доказывает контакт или согласие провайдера. Не отправлять без отдельного пользовательского решения.

### Статус верификации в этой итерации

- MAIN SHA проверен через GitHub: `c92ed7cd65f1a96d94363c2b7e212424ab078a73`; checkpoint branch HEAD до обновления: `8b3717c531d4995723f9c095237d950b46b0c2b8`.
- `ops/MODULE-MAP.md`, актуальные правила `pivnik-preflight` и обе обязательные references прочитаны в этой сессии; `Do not break` без изменений.
- GitHub Actions на предыдущем HEAD: **Pivnik release gate: in_progress/pending, run 41269222175**. У job уже подтверждены успехи двойной materialize/idempotence и syntax, но полный run на момент проверки **не завершён**. Не утверждать PASS всех тестов/аудитов/CI. Для HEAD этого docs commit проверить CI повторно.
- Рабочий каталог container `/` не содержит `.git` и не является checkout проекта. Локально `npm run materialize` ×2, `node --test`, `npm run check`, `npm audit`, native PG/E2E **не запускались**.
- Чужой Draft #96, касса, реальные данные, Railway, токены, SQL, env, routes, app code и production не изменены.
- **Следующий шаг в рамках 41:** подтвердить от провайдера test app + auth contract или получить разрешённый тестовый кабинет; после чего сделать только изолированные read-only/test events и обновить матрицу E01–E05, сохраняя UNKNOWN/FAIL/BLOCKED, если доказательство отсутствует. Не переходить к 42 и не merge/deploy.

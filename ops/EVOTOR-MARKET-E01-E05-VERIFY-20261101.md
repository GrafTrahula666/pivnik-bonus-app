# SPACEVERSE CHAT_05 · E01–E05 external contract evidence
Дата проверки: 2026-11-01. Режим: отдельная docs-only ветка, Draft PR, без merge/deploy/provider calls/secret changes.
Scope: только пункт 41 из CHAT_05.md. Не заменяет официальный тестовый кабинет и не изменяет вердикты E06–E13.

## Фактическая база (read-only)
- GitHub main: `c92ed7cd65f1a96d94363c2b7e212424ab078a73` (merge #324). #296, #299, #302 и #312 уже **merged** по API GitHub (29 октября); старые checkpoint в `ops/ADMIN-PILOT-MARKET-PROGRESS.md` описывают их как Draft и являются историческими.
- `ops/MODULE-MAP.md` в main: P0.1 callback inbox default-off; P0.2 store adapter, OAuth exchange, state, owner proof issuer, store binding и license policy UNMOUNTED. Наличие кода в main не означает активный endpoint/лицензию.
- Railway (read-only): проект `content-nature`, `admin-pilot` production, последний SUCCESS 2026-10-29 для main `febca6ae6ce7be85a53eaf0e4a38fe1f087385ff` (#312); более новый `c92ed7cd65f1a96d94363c2b7e212424ab078a73` имеет deployment SKIPPED от 2026-11-01. Это не подтверждает настройку callback, миграции, live OAuth или коммерческую активацию.
- Тестовый кабинет Эвотор, приложение/версия, реальная установка, тестовые события и прохождение OAuth **не проверены** в этой итерации; не записывать PASS на основании синтетического CI.

## E01–E05: что подтверждено официально и чего не хватает

| Gate | Документированный контракт (ссылки ниже) | Статус этого этапа | Нужное независимое доказательство |
|---|---|---|---|
| **E01 · издатель и договор** | Партнёрами могут быть разработчики, интеграторы, компании и стартапы. Официальная страница «Выплаты» указывает договор-оферту на **каждое** распространяемое приложение при размещении. | **PARTIAL**, а не PASS: публичные условия найдены, субъект издателя и договор SPACEVERSE не проверены. | Разрешённый кабинет издателя, действующая редакция/принятие договора, права публикации и подтверждение юридического лица; это решение владельца/Маркет. |
| **E02 · cloud/no-APK и запуск** | В Quick Start флажок «Приложение с APK» выбирается при установке на смарт-терминал. Cloud integration описывает приложение с доступом из кабинета/Маркета и серверные callback. Тестирование: добавить тестировщика, выложить версию, установить из ЛК. | **PARTIAL**: тип cloud без обязательного APK подтверждён как доступный; точный launch flow выбранного продукта, URL и реальная установка не проверены. | Тестовая версия, реальные настройки Integration/launch URL, тестовая установка и открытие на разрешённой учётной записи. |
| **E03 · установка/пользователь/магазин** | Callback installation содержит `productId`, `userId`, тип события; `GET /stores` перечисляет `id` и `user_id` для каждого магазина, с полной пагинацией. Эти идентификаторы сами по себе **не** являются canonical SPACEVERSE owner proof. | **PARTIAL/BLOCKED**: код default-off/unmounted, нет live provider→SPACEVERSE owner/company/venue связи. | Проверить реальный идентификатор при установке, authorizations, полный GET /stores и запрет cross-tenant/expired/replay на живом тестовом контуре. |
| **E04 · минимальные scopes** | OAuth-каталог явно содержит `store:read`, `device:read`, `document:read`, `product:read` и другие granular scopes. Для proof магазинов минимум `store:read`; доступ к документам/терминалам требует отдельного обоснования. | **PARTIAL**: каталог доступен, но фактически предоставленные scopes выбранной версии и право на необходимые данные пока UNKNOWN. | Проверить конфигурацию test OAuth client, ответ токена/scopes, реальные 200/403 по нужным API. Не запрашивать write scopes без отдельной задачи. |
| **E05 · выдача/ротация/отзыв credentials** | Токен Облака выдаётся паре приложение–пользователь; callback `/api/v1/user/token` после установки поддерживает заданный в кабинете app-token или Basic Auth. OAuth web client использует server-side `authorization_code` и exact redirect. | **PARTIAL/BLOCKED**: шифрование и revision guards подготовлены, но реальная ротация, revoke, повтор доставки и моментальный отказ новых запросов не доказаны. | Действительные тестовые events/token refresh/revoke, сверка актуального Authorization и ревизии под конкурентными запросами. Никакие токены/ключи в Git, PR, логах и отчёте не публиковать. |

## P0 ambiguity: webhook Authorization

- [Общее руководство по авторизации вебхуков](https://developer.evotor.ru/docs/doc_evotor_api_authorization.html) прямо говорит, что installation и subscription events авторизуются **токеном приложения стороннего сервиса**.
- [Схема POST /installation/event](https://developer.evotor.ru/docs/rest_api_webhooks_post_installation_event.html) и [POST /subscription/event](https://developer.evotor.ru/docs/rest_api_webhooks_post_subscription_event.html) называют `Authorization` **токеном пользователя приложения стороннего сервиса**.
- Это противоречие нельзя решать ослаблением validation либо предположением, что любой bearer подходит. Точный credential type у `/api/v1/user/token`, install и subscription проверять на реально полученных разрешённых test events; до этого auth gate остаётся fail-closed/default-off. Отдельно сохранять порядок subscription sequence и sticky reconciliation holds.

## OAuth state: отдельный внешний gate для пункта 44

[OAuth guide](https://developer.evotor.ru/docs/rest_oauth20_authorization_guide.html) показывает redirect с параметром `code`, а документированный пример ссылки не подтверждает отражение клиентского `state`. Durable одноразовый state реализован как UNMOUNTED, но без real round-trip `state` не считать OAuth flow безопасно готовым. Не монтировать авторизацию на основании одного только `code`.

## Официальные источники (проверены 2026-11-01)

- E01: https://developer.evotor.ru/conditions/ ; https://developer.evotor.ru/docs/doc_payoff.html
- E02: https://developer.evotor.ru/docs/doc_evotor_api_introduction.html ; https://developer.evotor.ru/docs/doc_cloud_systems_integration.html
- E03: https://developer.evotor.ru/docs/rest_api_webhooks_post_installation_event.html ; https://developer.evotor.ru/docs/rest_stores.html
- E04: https://developer.evotor.ru/docs/rest_oauth20_authorization_guide.html
- E05: https://developer.evotor.ru/docs/doc_authorization.html ; https://developer.evotor.ru/docs/doc_evotor_api_authorization.html ; https://developer.evotor.ru/docs/rest_api_webhooks_post_subscription_event.html

## Checkpoint CHAT_05 / 41

- **41 = IN PROGRESS / BLOCKED ON REAL TEST ACCOUNT**, не PASS. Это результаты официального документального read-only review; никаких live credential/event tests не проводилось.
- Выполнено: проверено main/merged PR/модульная карта/Do not break/Railway deployment read-only; публичные источники E01–E05; конфликт Authorization сохранён без ослабления.
- Изменение: только этот documentation evidence/checkpoint файл. Runtime, роуты, SQL, CI, env, secret, production не меняются. Никаких чужих PR не переписывали.
- Проверки: `npm run materialize`×2, `node --test`, `npm run check`, `npm audit`, native PostgreSQL, browser и реальный Эвотор в этом GitHub-only сеансе **НЕ запускались**. Их результат не заявляется PASS. При открытии Draft PR отдельно проверить CI на его exact HEAD.
- **Следующее действие (всё ещё пункт 41):** на разрешённом тестовом аккаунте/версии проверить E01 publisher proof, E02 установку, E03 install+store identity, E04 granted scopes, E05 реальный token/revoke flow и разногласие auth. До этого E01–E05 не отмечать полностью закрытыми, к пункту 42 не переходить.
- Перед передачей координатору чата 01 проверить свежий main и CI, Draft PR не мержить самостоятельно.

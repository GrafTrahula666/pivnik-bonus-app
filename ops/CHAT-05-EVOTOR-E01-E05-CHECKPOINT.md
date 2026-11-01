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

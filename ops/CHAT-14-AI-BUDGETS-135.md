# SPACEVERSE · CHAT 14 · №135 — AI usage, budgets, quotas, request ledger и kill switch

**Дата:** 2026-11-01. **Статус:** проект контракта, **не работающая система тарификации**.  
**Scope:** один документ, отдельный Draft PR. Никаких платных запросов, миграций, feature activation, изменений production, секретов или сторонних провайдеров.

## 1. Проверенное основание и границы

- База: `main c92ed7cd65f1a96d94363c2b7e212424ab078a73`; перед записью прочитан актуальный `ops/MODULE-MAP.md` и раздел **Do not break**. Денежная логика ПИВНИКА, Эвотор, киоск, patch-chain, admin auth/routes не затронуты.
- `ops/SAAS-ANALYTICS-AI-ARCHITECTURE.md` описывает **будущую** preflight-проверку feature flag, CRM entitlement, независимого AI add-on, разрешений, credential, quota, atomic reservation, usage ledger и `unknown` после неясного timeout. Это не доказательство существующей исполняемой реализации.
- CHAT 14 [#341 (131)](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/341): три владельческих сценария; [#352 (132)](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/352): allowlisted tenant-safe aggregate tools; [#356 (133)](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/356): **не смерженный** код `ADMIN_ENABLE_AI=false`, ручная миграция AI entitlement `027`; [#364 (134)](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/364): статический synthetic preview без provider/API. На проверенных HEAD этих PR GitHub Release Gate завершился `success`; все ждут интеграционного review.
- Раздел 135 по приложенному `CHAT_14.md` требует **описать** budgets/quotas/ledger/kill switch. Ни один из приведённых ниже типов, таблиц и команд пока **не** является работающим endpoint или реальным billing-счётом. Переход к реализации требует отдельного atomic-state PR и разрешения на любые production изменения.
- Единицы денег, прайс, курс, тарифные лимиты, поставщик и реальные правила биллинга **не подтверждены**. В этом документе намеренно нет выдуманных ₽/USD или количества бесплатных токенов.

## 2. Условия, без которых billable запрос запрещён

**Обязательный server-side gate перед каждым запросом и каждым tool call:**

1. Живая Admin session → canonical `companyId/venueId` → проверка owner/role и прав метрик; доверенный директор не наследует AI из разрешения `GET pos`. SUPER_ADMIN не обходит entitlement.
2. Отдельная проверка допустимости CRM-плана (когда она требуется контрактом продукта) **и** независимый AI entitlement со статусом `active` на **точно выбранную** точку и валидной датой, плюс глобальный/tenant feature flag. `null`, отсутствующая таблица, невыданное право, expired, suspended, недоступная БД → **deny**, не `true`.
3. Глобальный kill switch, tenant kill switch и provider/model kill switch все однозначно **allow**; любое missing/unknown/deny → `AI_DISABLED`.
4. Только зарегистрированный провайдер, разрешённая модель и HTTPS destination из server registry, credential должен быть действительным и храниться серверно, не в браузере. Нет произвольного base URL, ключей в prompt/snapshot/log.
5. Одобренная `pricingVersion`, `currency`, строгий pricing unit и оценка **верхней** стоимости, основанная на ограниченном max input/output. Если цену, единицу или верхнюю границу стоимости нельзя доказать, **не вызывать платный API**.
6. Наличие явно утверждённого policy для точного canonical venue с положительным budget в согласованной валюте, request/token/concurrency caps и периодом. **Отсутствующее значение не означает unlimited**; `0` означает отказ, не «бесплатно».
7. Успешная **атомарная reservation** на глобальную/tenant квоту и бюджет с уникальным `requestId` **до отправки** провайдеру.

Наличие CRM-подписки, API-ключа, синтетического preview либо записи об установке Эвотора **не** удовлетворяет требованиям AI add-on. Ни один UI toggle сам по себе не выдаёт право на платный запрос.

## 3. Иерархия лимитов и их смысл

| Уровень | Поля предполагаемой политики | Семантика |
|---|---|---|
| Platform | `enabled`, `hardKill`, `maxConcurrent`, `monthlyBudget` | Общий предел затрат платформы; включение требует явного решения владельца |
| Provider/model | `enabled`, `allowedModel`, `maxInputTokens`, `maxOutputTokens`, `perCallMaxCost`, `pricingVersion` | Запрет неизвестной цены или модели; внешний API не вызывается при отсутствии registry записи |
| Company/venue | `venueId`, `budgetPeriod`, `currency`, `monthlyCostCap`, `dailyRequestCap`, `monthlyTokenCap`, `maxConcurrent`, `hardKill`, `revision` | Точка не делит бюджет с другой точкой по умолчанию; общий лимит сети накладывается **сверху**, не заменяет per-venue |
| Actor | `actorId`, `requestsPerMinute`, `maxOutstanding` | Защита от скриптов и ошибок UI; не расширяет права actor |

**Правила расчёта:** задавать окна в UTC с документированной границей и неизменной timezone определения. Внутри одного периода не смешивать currencies, модели/pricing versions без явной нормализованной pricing ledger; глобальный бюджет с разными валютами нельзя сложить «по числам». Денежные значения хранить точными decimal/integer minor units (без float). Порог `0` запрещает расход. `NULL` или `not_configured` блокирует billable request. Многократные параллельные запросы обязаны учитывать уже зарезервированную, но ещё не подтверждённую стоимость.

**Затраты:** `estimatedMaxCost` рассчитывается по зарегистрированному верхнему тарифу/лимитам; реальный `providerReportedCost` и `providerReportedTokens` могут быть `null`. `null` не становится бесплатным вызовом. Дополнительный расход сверх reservation переводит инцидент в `overrun/unknown` и блокирует дальнейшие вызовы до сверки.

## 4. Журнал запросов: минимальные поля и статусы

Предлагаемая server-owned `AiRequestLedger` (приватная metadata, **не** guest/loyalty ledger):

| Поле | Назначение |
|---|---|
| `requestId` (UUID, unique), `createdAt`, `updatedAt` | Идемпотентность и chronology; повтор того же ID не запускает второго провайдера |
| `companyId`, `venueId`, `actorId`, `scopeRevision` | Авторизованный scope для security/audit, никогда не берётся из tool arguments |
| `toolOrQuestionId`, `providerId`, `modelId`, `pricingVersion` | Разрешённая server registry reference; никакого credential value |
| `mode` (`synthetic|provider`), `status`, `startedAt`, `finishedAt` | Чёткая классификация; synthetic не доказывает AI или стоимость |
| `reservedMaxCost`, `reportedCost`, `currency`, `inputTokens`, `outputTokens` | Числа могут быть `null` **только в предписанных состояниях**; неизвестная цена не считается нулём |
| `sourceSnapshotRef`, `errorCode`, `policyRevision` | Ссылка на повторно авторизуемый snapshot и безопасный код ошибки, без prompt/PII/raw exception |

**Не сохранять:** сырые вопросы, контакты, тексты клиента, документы кассы, SQL, cookie, Authorization header, API keys, исходные ответы провайдера, абсолютные URL, пользовательские финансовые идентификаторы. Opaque snapshot refs не должны позволять обход tenant доступа. Просмотр журнала/экспорт всегда повторно проверяют actor/company/venue/RBAC; SUPER_ADMIN и владельцу показывать только нужные поля, не секреты. Для retention/TTL, удаления и доступности аудита требуется утверждённая политика данных до миграции.

**Состояния и операции:**
- `reserved`: budget удержан, provider ещё не обязательно вызван; запись создана до вызова.
- `succeeded`: provider подтвердил завершение; сохранить фактическое usage/cost или `unknown` с резервом, если usage неполный.
- `failed_before_send`: доказано, что платный вызов **не** отправлен; резерв может освобождаться атомарно с audit.
- `unknown`: timeout, отрыв соединения, неполный provider receipt или неизвестная цена: считать максимальную стоимость занятой; **не делать автоматический повтор платного вызова**.
- `reconciled`: исправление usage/status только по проверенному receipt/provider evidence, с actor, временем, immutable audit-событием.
- `cancelled`: допустимо лишь при доказанном отсутствии charge или корректном provider cancellation evidence. Клиентский abort не доказывает отмену тарификации.

Записи и переходы должны быть идемпотентны: ранее завершённый `requestId` повторно возвращает его сохранённое состояние или безопасную ошибку, но никогда не запускает ещё один billable call. `failed_before_send` нельзя произвольно ставить после отправки.

## 5. Atomic reservation и гонки (контракт будущей реализации)

1. В транзакции PostgreSQL прочитать policy конкретного tenant/venue и глобальные ограничения, **заблокировать** необходимые строки в фиксированном порядке (`FOR UPDATE` или эквивалентный проверенный mutex).
2. На одной согласованной snapshot/transaction вычислить сумму `reserved+succeeded+unknown` в текущем периоде, число запросов, токены, outstanding и проверить верхний bound данного вызова.
3. В той же транзакции создать uniquely keyed ledger row `reserved`; при конфликте requestId / превышении лимита / неавторизованном scope → rollback/deny. Нельзя сделать SELECT availability, а затем независимый INSERT без lock.
4. Только **после commit** reservation и повторной проверки kill switch/provider/entitlement разрешён один исходящий вызов.
5. После ответа записать usage и terminal status в транзакции; при неоднозначном timeout сохранить `unknown` с удержанием резерва. Подтверждённые суммы и целостность финансового следа нельзя удалять/ослаблять ради retry.

Фактическая реализация потребует отдельно выбранных locking/order стратегии, transaction isolation, crash recovery, reconciliation и теста **двух одновременных запросов** на одном venue, плюс теста двух разных tenants с независимыми budget scopes. Нельзя гарантировать предотвращение provider charge только на основании внутренней записи: upstream idempotency token следует использовать **если** он документирован провайдером; иначе ambiguous timeout ведёт в reconciliation.

## 6. Kill switch и немедленный отказ

- **Главный аварийный выключатель:** глобальный server-side hard-deny по умолчанию, без предположения `unknown=true`. Отдельные выключатели provider/model, компании и конкретного venue. Приоритет любого deny выше entitlement, budget и UI. Предлагаемый интерфейс будущего ops: `GET status` read-only и отдельная административная команда `disable` с подтверждённой сессией, CSRF, RBAC, revision и аудитом. **Здесь нет действующей команды/endpoint.**
- **Необходимая реакция:** новые резервы и будущие tool calls отвергаются немедленно; в процессе выполнения необходимо вызвать `AbortSignal` и прекратить дальнейшие tool calls. Уже посланный billable запрос **может** быть тарифицирован провайдером даже после abort, поэтому его ledger остаётся reserved/unknown до подтверждения.
- **Восстановление:** hardKill снимается только через отдельное явное одобренное изменение, в рамках бюджета, с повторной проверкой entitlement/provider/security и журналом кто/когда/зачем. Никакого автоматического re-enable после restart, TTL или ошибки синхронизации. Сбой хранения kill switch трактуется как запрет.
- **Rollback:** для ещё не подключённого AI достаточно не включать adapter/flag. Для будущей боевой реализации операционный rollback — поставить kill switch в deny, проверить отсутствие новых provider calls и сохранить charge ledger для сверки; удалять записи или сбрасывать квоты нельзя.

## 7. Приёмка будущего исполняемого guard и негативные тесты

1. Default-off: нет policy/credential/migration/license/valid price → 0 внешних вызовов, `not_configured/forbidden`, ни «бесплатного AI», ни успешного запроса.
2. Two-tenant / two-venue: actor A не видит policy/ledger B; multi-venue не объединяется по умолчанию; изменение role/venue/сессии после создания snapshot заставляет повторную проверку.
3. Параллельные запросы на последний бюджет: не более одного reservation; проверка реальным PostgreSQL, не только моками.
4. Rate + cost + tokens + concurrency caps: каждый превышенный guard отказывает; `NULL` / `0` / разные валюты / неизвестный тариф обрабатываются явно.
5. Повтор `requestId`, двусмысленный timeout и provider 5xx: ни одного автоматического duplicate-charge; unknown удерживает reserved budget; воспроизводимый reconciliation.
6. Kill-switch на global/provider/company/venue после reservation и во время streaming: новые запросы отклоняются, ongoing best-effort abort, отсутствие ложных «возвратов» без receipt.
7. Журнал/экспорт: никаких секретов и PII, tenant-safe RBAC, контроль размера логов и TTL; ошибки provider sanitised. Не считать успешный synthetic preview доказательством работы реального provider.
8. Failure injection: DB outage, contention/deadlock, restart, expiry, stale registry, revocation, price change между reservation/settlement. Fail closed без денежных операций пользователя.

Это **acceptance test plan**, а не результаты выполненных тестов.

## 8. Решения, необходимые перед пунктом 140 и production

Ожидаются подтверждённый провайдер с договором/API idempotency, цена и версия прайса, валюта и единицы расчёта, утверждённые hard budgets/periods/limits, сроки хранения журнала и права просмотра, ответственный за reconciliation, rollback-процедура и explicit paid API authorization. Ни одного из этих фактов нельзя заполнять выдумкой. AI KPI/прогнозы не запускать на непроверенных данных.

## Checkpoint CHAT 14 / 135

- **Задача:** 135; результат — документированный механизм budget/quota/usage ledger/kill switch, **без runtime/DB изменений**. Это не основание считать AI подключённым.
- **Base SHA:** `c92ed7cd65f1a96d94363c2b7e212424ab078a73`. **Ветка:** `spaceverse/chat14-ai-budgets-135-20261101`. Первый commit `f5f6bcfd26120b2588dcaa369c77b6dc0987fd0a`; уточнение `d6397bf2f0aab8c26776dd98f7f95a64823cc194`; **Draft PR [#369](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/369)**. Актуальный HEAD и CI перепроверять после каждого изменения; не считать SUCCESS до завершения.
- **Проверено:** актуальный main, origin ветки по AI, `ops/MODULE-MAP.md` Do not break, целевая архитектура и 131–134 PR/CI. Local checkout/команды отсутствуют: не выдавать npm тесты за локально выполненные.
- **Риски:** будущий AI payment требует финансового и security review. Никаких платных API, ключей или изменений production.
- **Передача:** Draft координатору CHAT 01; review + применимый GitHub Release Gate; затем отдельный пункт 136: evidence/sources/insufficient data.
- **Hourly schedule:** CHAT14 automation ранее не создавалась из-за лимита 5/5. Другие пять задач не останавливать.

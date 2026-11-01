# SPACEVERSE · CHAT 09 · Каталог метрик v0 (пункт 81)

> **Статус:** документирование фактических read-only контрактов `origin/main` на 2026-11-01, SHA `c92ed7cd65f1a96d94363c2b7e212424ab078a73`. Это **не** запущенный metric-registry/API/report-builder и не свидетельство готовности коммерческого SaaS. Никаких runtime/SQL/UI/production изменений этот документ не вносит.
>
> **Область CHAT 09:** только аналитика/отчёты/экспорт. Пункты 82–90 отдельно. Перед интеграцией сверить этот каталог с новым `main`; приоритет у кода и provider evidence, не у этого файла.

## 1. Общий контракт и источники

Существуют **два разных источника**, которые нельзя называть одной «выручкой»:

1. **Evotor POS**: `pos/evotor-document.js` нормализует только `SELL` и `PAYBACK`; `pos/repository.js` читает импортированные документы разрешённого магазина с допустимым `close_date`; `pos/analytics.js:summarizePos/posDashboards` формирует `all`, `app` и `unlinked`; `admin-platform/server/evotor-read.ts:getEvotorReport` находит привязку магазина по **`tenant_id=scope.companyId`, `location_id=scope.id`**. `app` и `unlinked` являются частями `all`, а не дополнительной выручкой. Отсутствие схемы/привязки/успешного sync даёт `all:null`, не нули.
2. **Legacy loyalty ledger PIVNIK**: `admin-platform/server/data.ts:periodMetrics/getVenueDashboard` читает `transactions`, `users`, `bar_customers`, `wallets`. `requireLegacyBar` запрещает иной `companyCode` и требует `legacyBarId`. Это **не** полная фискальная выручка кассы и **не** универсальный источник для других tenants. Записи покупки и операций могут не соответствовать друг другу 1:1.

**Scope/authorization.** Перед вызовом read-моделей сервер обязан определить `VenueScope` из текущей Admin session (`resolveVenueScope`) и проверить право на читаемый ресурс (`requireVenueAccess`). Сам `venueId` из URL не является разрешением. Существующий grant проверяется на уровне компании; право на будущий конструктор или CSV/PII **не следует** из права GET dashboard. Aggregation по нескольким venue допустима только после повторного разрешения каждой точки и проверки совместимости источников/валют. Cross-tenant запрос запрещён.

**Время.** Везде фильтр начала включительно, конца исключительно: `[from, to)`, границы передаются ISO UTC. POS `evotorPeriod`: `date` или `from/to` (в UI конечный день включительно), 1–366 московских календарных дней, пресеты 1/7/14/30/90/365, `Europe/Moscow` (UTC+03). Legacy `parsePeriod`: относительное окно по UTC milliseconds (1/7/30/90/365) или ISO `from/to`; это **не тот же календарный период**. `parseOperationsPeriod` отдельно поддерживает московский календарь 1/7/14/30/90/365. Нельзя сравнивать/складывать разные окна без явной нормализации (пункт 82).

**Деньги и единицы.** POS суммы приходят в целых копейках как decimal strings (обработка `BigInt`); `netCents` может быть отрицательным. Legacy API возвращает рубли `Number(cents)/100`, бонусы в **баллах**, а не в рублях. Целевая валюта для PIVNIK — RUB, но существующий POS response не содержит авторитетного ISO currency; **для новой компании/кросс-venue агрегации валюту считать UNKNOWN до подтверждения источником**, не делать конвертацию по догадке. Формат количества POS `quantityMillis`: тысячные части измеряемой единицы позиции; значение `measure` обязательно показывать отдельно.

## 2. Текущие подтверждённые POS-показатели

Префикс ID `pos.*` ниже — **предлагаемая стабильная нотация каталога v0, не существующие endpoint keys**. Все POS-метрики: population = импортированные нормализованные `SELL/PAYBACK` документы разрешённого `storeId` с валидным `close_date`, timestamp `closedAt`, scope = `companyId + venueId + storeId`, source = `pos/analytics.js` после `getEvotorReport`. Валюта RUB только при подтверждённом денежном контексте источника; при отсутствующей currency metadata новая cross-venue денежная сумма недоступна.

| ID каталога | Фактическое поле | Формула / единица | Важная граница |
|---|---|---|---|
| `pos.sales_gross` | `all.salesCents` | Σ `amountCents` по `SELL`, коп. | Не вычитать возвраты здесь |
| `pos.returns` | `all.returnsCents` | Σ положительных `amountCents` по `PAYBACK`, коп. | Возврат не отдельная продажа |
| `pos.sales_net` | `all.netCents` | `salesCents - returnsCents`, коп. | Не маржа/прибыль |
| `pos.sell_documents` | `all.saleDocuments` | Количество `SELL` документов | **Не** количество фискальных чеков |
| `pos.return_documents` | `all.returnDocuments` | Количество `PAYBACK` документов | Без вывода о числе посетителей |
| `pos.receipts` | `all.receiptCount` | Σ `receiptCount` по SELL, шт. | **null**, если хотя бы у одного SELL `receiptCount` неизвестен; `knownReceiptCount` не подставлять |
| `pos.average_sell_receipt` | `all.averageCents` | SELL gross / `receiptCount`, коп. (существующее integer rounding) | **null**, если denominator = 0 или неизвестен; возвраты не уменьшают numerator |
| `pos.linked_sales` | `app.salesCents` | SELL gross только с подтверждённым `clientId` | Подмножество `all`; не складывать `all + app` |
| `pos.unlinked_sales` | `unlinked.salesCents` | SELL gross без `clientId` | Анонимный чек не создаёт CRM identity |
| `pos.linked_sales_share` | `linkedRevenueSharePercent` | `app.salesCents/all.salesCents × 100`, % | **null** при gross SELL = 0, не доля посетителей |
| `pos.linked_buyers` | `app.activeBuyers` | DISTINCT linked `clientId` по SELL | Не app DAU и не количество визитов |
| `pos.repeat_linked_buyers` | `app.repeatBuyers` | Linked клиенты с более чем одним SELL документом **в выбранном периоде** | Это не когортный retention |
| `pos.repeat_linked_rate` | `app.repeatPurchaseRate` | `repeatBuyers/activeBuyers × 100`, % | **null** при отсутствии linked покупателей |
| `pos.linked_purchase_frequency` | `app.purchaseFrequency` | `app.saleDocuments/app.activeBuyers`, документов на клиента | **null** при 0 linked buyers |
| `pos.day_net` | `all.days[]` | Σ signed SELL/PAYBACK в локальном дне, коп. | Группировка `Europe/Moscow`; отсутствие ряда не подтверждает синхронизацию |
| `pos.hour_net` | `all.hours[]` | Σ signed SELL/PAYBACK по часу 00–23, коп. | Для диапазона дни **схлопываются в одинаковый час** |
| `pos.product_net` | `all.products[]` | Для пары `productId/name/measure`: `salesCents-returnCents`, коп. | Категория товара не выводится из названия; quantity в `quantityMillis` |

`close_date` в нормализаторе не подтверждает наличие фискального чека: без `pos_print_results` число чеков остаётся неизвестным. Присутствие `lastSuccessAt` означает зафиксированную успешную синхронизацию, **не доказательство полноты конкретного периода**. Данные с отсутствующей связью/схемой/синхронизацией нельзя превращать в «0 продаж».

## 3. Текущие legacy PIVNIK-показатели

Все показатели ниже: только `companyCode='pivnik'` и привязанный `legacyBarId`; фильтр текущих данных — активные `bar_customers` + немерженные/неудалённые `users.role='client'`; период операций: `COALESCE(completed_at,created_at)∈[from,to)`, `status='completed'`. Источник: `admin-platform/server/data.ts:periodMetrics`. У `totalCustomers` и `outstandingBonusBalance` **нет исторического as-of**: текущий состав/баланс даже при выборе прошлого периода.

| ID каталога | Текущее поле API | Определение / единица |
|---|---|---|
| `loyalty.tracked_cash_paid` | `trackedRevenue.value` | Σ `cash_paid_cents` среди completed `mode IN ('accrue','redeem')` / 100, RUB; **не** total POS revenue |
| `loyalty.check_rows` | `checkCount.value` | Количество completed accrue/redeem строк с `check_amount_cents>0` (не фискальный чек) |
| `loyalty.average_check_row` | `averageCheck.value` | SQL `AVG(check_amount_cents)` по указанным положительным строкам / 100 RUB; **null**, если строк нет |
| `loyalty.operations` | `operationCount.value` | COUNT всех completed transaction rows, включая иные `mode` |
| `loyalty.customers_total_current` | `totalCustomers.value` | COUNT активных canonical members **сейчас**, вне периода |
| `loyalty.customers_new_account` | `newCustomers.value` | Активные canonical members, `users.created_at` внутри периода; не первая покупка |
| `loyalty.customers_tx_active` | `activeCustomers.value` | DISTINCT `client_id` с любой completed transaction в периоде; не визиты/DAU |
| `loyalty.customers_prior_purchase` | `returningCustomers.value` | DISTINCT текущих transaction clients с completed `accrue/redeem` **до начала** периода; текущая операция не ограничена этим mode |
| `loyalty.bonus_earned` | `bonusEarned.value` | Σ `bonus_earned` в completed rows, кроме определённых staff/admin/manual gift adjustments; баллы |
| `loyalty.bonus_redeemed` | `bonusRedeemed.value` | Σ `bonus_spent` во всех completed rows периода; баллы |
| `loyalty.bonus_balance_current_ex_gifts` | `outstandingBonusBalance.value` | Σ по текущим wallets `GREATEST(balance - completed positive staff/admin/manual gift awards,0)`; баллы, не ₽ |
| `loyalty.bonus_redemption_rate` | `redemptionRate.value` | `bonusRedeemed/bonusEarned × 100`; **null**, если earned=0; доля баллов, не денежная ставка |

**Оговорка источника:** исторические операции в запросе `previous_tx` проверяются по `client_id`, без отдельного фильтра прошлой операции на тот же `bar_id`; это ограничение семантики `returningCustomers`, а не подтверждённая cross-venue метрика. `data.ts` подписывает `returningCustomers` словами «registered before period», но SQL определяет наличие **предыдущей операции accrue/redeem**. Старый `admin-platform/PRODUCTION-METRICS.md` тоже описывает эту метрику через дату регистрации; это **дрейф описания**, а не доказательство ошибки подсчёта. Изменение UI/API/теста вынести отдельным scope после согласования. Тот же старый документ описывает bonus balance без исключения подарков, а актуальный код их исключает. Эти расхождения не исправляются документом.

## 4. Что остаётся unavailable и правила будущего API

- `visits`, `dau`, `wau`, `mau`, `retention7/30/90`: API явно возвращает `available:false, value:null`; подтверждённых venue visits/app_activity для них нет. Запрещено делать ненулевой DAU из транзакций.
- Полная универсальная CRM-аналитика других компаний, новая/повторная покупка по общей verified identity, RFM/LTV, произвольный товарный рейтинг по категориям, маржа, себестоимость, multi-venue денежные суммы, новые PDF/CSV экспорты: **не доказаны существующим контрактом**. Документ не объявляет их работающими.
- Текущие hourly legacy и POS отличаются по population и группировке. `getVenueDashboard` строит trend и при `hourly=true` отдельный агрегат по часам; `pos/analytics.js` сворачивает один час по всем дням. Для пункта **82** потребуется отдельный проверяемый server-side aggregate contract, не «переименовать ось».
- В будущем registry должен сообщать `id`, `schemaVersion`, `source`, `population`, `scope`, `currency/unit`, `timeField`, `timezone`, `period`, `aggregation`, `precision`, `asOf/freshness/coverage`, `status` и `reason`. Этот envelope **ещё не реализован**.
- Статусы различать: `available` с подтверждённым 0, `unavailable` (missing source/binding/identity), `stale` (данные были, свежесть не подтверждена), `forbidden` (без права), `error`. Никаких «0 ₽» вместо отсутствующего источника.
- Показатели разных источников не складывать; сумму net считать через суммирование money numerators на сервере с проверкой валюты; средние/rates нельзя усреднять без знаменателей. Новый CSV/export требует **отдельной серверной field-level + tenant authorization** (пункт 89).

## 5. Checkpoint CHAT 09 / 81

- **Основание:** `CHAT_09.md` (пункты 81–90), актуальный на момент подготовки `main c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
- **Сделано:** один документационный срез по пункту **81**, без изменения runtime, миграций, тестов, config или секретов. Переиспользованы уже существующие `ops/SAAS-ANALYTICS-AI-ARCHITECTURE.md` и `admin-platform/PRODUCTION-METRICS.md` с перепроверкой фактических read-models.
- **Технический риск:** P1/P2, несовпадающие определения ledger/receipt/period и неустановленная валюта для будущего multi-venue. P0 tenant/prod guard не тронут.
- **Проверка:** нужно подтвердить SHA этого Draft PR, read-back документа и CI; локальный clone/npm недоступны в этой сессии, не заявлять `node --test`, double materialize, `npm run check` или `npm audit` как PASS без вывода. **Пункт 81 считать проверенным только после доступных документных/CI гейтов.**
- **Следующий запуск:** сначала перепроверить HEAD main/PR/CI и чужие ветки; если каталог 81 прошёл проверку, зафиксировать завершение и переходить ровно к пункту 82; иначе продолжить 81. Другие чаты/код не трогать. Сохранить Draft PR координатору чата 01; не мержить/деплоить.

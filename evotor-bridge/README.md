# PIVNIK для Эвотора — мост «QR клиента → чек» (прототип)

**Статус: прототип. Не merge, не deploy, production и БД не затронуты.**
Отдельное Android‑приложение для смарт‑терминала Эвотор. Единственная задача — когда бармен
сканирует персональный QR PIVNIK во время продажи, записать в этот чек
`Extras = {"pivnik_user_id":"<id>","pivnik_v":1}`. Суммы, товары и сам факт продажи берутся
только из закрытого кассового документа Эвотора (облако → backend); приложение их не передаёт
и не меняет.

Сценарий бармена: пробил заказ в обычном UI → отсканировал QR клиента обычным сканером →
продолжил оплату. Видит только тост `PIVNIK ✓ Кирилл`. Ничего нажимать не нужно.

## Источник истины по SDK

Официальная библиотека `evotor/integration-library`, тег **v0.6.40** (последний на момент
работы), подключение `com.github.evotor:integration-library:v0.6.40` через JitPack (как в её
README). minSdk 23 / targetSdk 30 — взяты из `build.gradle` библиотеки.

Каждый класс, метод, action и permission в коде взяты из исходников этого тега (пути ниже —
относительно `src/main/java/` библиотеки). Сайт `developer.evotor.ru` из среды разработки был
недоступен (сетевая политика), поэтому ссылки на статьи — это ссылки из javadoc самих
исходников; их нужно открыть и сверить вручную перед установкой на кассу.

| Механизм | Исходник в SDK | Статья (из javadoc) |
|---|---|---|
| Событие сканирования в продаже | `ru/evotor/framework/receipt/formation/event/handler/service/SellIntegrationService.kt`, `.../formation/event/ReturnPositionsForBarcodeRequestedEvent.kt` | https://developer.evotor.ru/docs/doc_java_return_positions_for_barcode_requested.html |
| Запись extra | `ru/evotor/framework/core/action/event/receipt/changes/receipt/SetExtra.kt` | — |
| Событие скидки на чек (принимает SetExtra) | `ru/evotor/framework/core/action/event/receipt/discount/ReceiptDiscountEvent.java`, `ReceiptDiscountEventResult.java` | — |
| Запуск события скидки по требованию | `ru/evotor/framework/receipt/formation/api/SellApi.kt` (`triggerReceiptDiscountEvent`), `.../trigger_receipt_discount_event/TriggerReceiptDiscountEventException.kt` | — |
| Запрос сервиса скидки при переходе к оплате | `ru/evotor/framework/core/action/event/receipt/discount_required/ReceiptDiscountRequiredEvent.kt`, `ReceiptDiscountRequiredEventResult.kt` | — |
| Изменение позиций (принимает SetExtra) | `ru/evotor/framework/core/action/event/receipt/before_positions_edited/BeforePositionsEditedEvent.java`, `BeforePositionsEditedEventResult.java` | — |
| Обработчик action‑событий | `ru/evotor/framework/core/IntegrationService.java` | — |
| Открытый / закрытый чек | `ru/evotor/framework/receipt/ReceiptApi.kt` (`getReceiptHeader`, `getReceipt`) | — |
| Жизненный цикл чека | `ru/evotor/framework/receipt/event/handler/receiver/SellReceiptBroadcastReceiver.kt` | https://developer.evotor.ru/docs/doc_java_broadcastreceiver.html |

## Ответы этапа 1

1. **Версия SDK.** integration-library v0.6.40 (JitPack), minSdk 23, targetSdk 30.

2. **Событие сканирования.** `SellIntegrationService` (action
   `ru.evotor.event.sell.BARCODE_RECEIVED`, permission
   `ru.evotor.permission.SELL_INTEGRATION_SERVICE`), метод
   `handleEvent(ReturnPositionsForBarcodeRequestedEvent)`. Событие содержит `barcode`,
   `extractedData`, `creatingNewProduct`. Приходит только при формировании чека продажи
   (возвраты сюда не попадают). Глобальный `ScannerBroadcastReceiver` не используется — он
   срабатывает на любой скан вне контекста чека.

3. **Как отличить QR PIVNIK.** Только два строгих формата, которые выдаёт существующий backend:
   `PIVNIK:<qr_token>` (то, что кодирует QR в приложении, `server.js POST /api/me/qr`,
   токен base64url) и короткий код `PVK-XXXX-XXXX`. Сервер принимает и «голый» токен, но касса
   его **не** принимает — иначе любой штрихкод товара мог бы уйти на сервер. Всё остальное
   (EAN, DataMatrix, QR товара) → `return null`, касса обрабатывает код штатно.
   Код: `core/PivnikQr.java`, тесты `PivnikQrTest`.

4. **Существующий endpoint.** `POST /api/staff/qr/resolve {payload}` →
   `{qrToken, shortCode, client:{id, firstName, …}}` (логика `qr-resolver.js
   resolvePersonalQrRecord`, отзыв алиасов учитывается). Новый формат QR не придуман, raw user
   ID в QR не кладётся — идентификатор получаем от сервера. Ограничение: endpoint требует
   Bearer‑сессию сотрудника (Telegram/VK‑логин, роль staff/admin, termsAccepted), у кассы такой
   учётки нет → см. п. 12 и `BACKEND-CONTRACT.md`.

5. **Какое событие SDK возвращает SetExtra.** Результат сканирования
   (`ReturnPositionsForBarcodeRequestedEvent.Result(iCanCreateNewProduct, positions,
   positionsList)`) **не принимает SetExtra** — «вернуть extra из скана» в SDK невозможно.
   SetExtra принимают: `ReceiptDiscountEventResult`, `BeforePositionsEditedEventResult`,
   `PaymentSelectedEventResult`, `PrintGroupRequiredEventResult`, `PositionsMergeEventResult`,
   результаты делегатора оплаты и команды открытия чека. Выбрана последовательность:
   - скан → сразу пустой `Result` (код «поглощён», в чек ничего не добавлено);
   - в фоне: `ReceiptApi.getReceiptHeader(ctx, Receipt.Type.SELL)` → резолв на сервере →
     повторная проверка, что открыт тот же чек → запоминание связки;
   - `SellApi.triggerReceiptDiscountEvent(ctx, ComponentName(наш сервис), callback, null)` —
     официальный способ попросить кассу прямо сейчас вызвать наш `ReceiptDiscountEvent`
     (permission `ru.evotor.permission.TRIGGER_RECEIPT_DISCOUNT_EVENT`);
   - наш обработчик `evo.v2.receipt.sell.receiptDiscount` отвечает
     `ReceiptDiscountEventResult(BigDecimal.ZERO, SetExtra(json), [], null)` и только если
     `event.receiptUuid` совпадает с запомненным;
   - страховки: `ReceiptDiscountRequiredEvent` (касса спрашивает сервис скидки при переходе к
     оплате; отвечаем своим ComponentName только пока есть связка) и
     `BeforePositionsEditedEvent` (перезапись того же extra при правке позиций, денежных полей в
     результате нет).
   `PaymentSelectedEvent` отвергнут: он приходит только после выбора «Банковская карта» и
   ручного выбора приложения кассиром — для наличных не работает.

6. **Гарантия «правильного» чека.** Связка = `(receiptUuid, userId)`. UUID берётся из открытого
   чека в момент скана и перепроверяется после ответа сервера; если чек сменился — связка не
   создаётся. SetExtra возвращается только в событии с тем же `receiptUuid`. TTL связки 3 ч.
   После `RECEIPT_CLOSED` закрытый чек читается через `ReceiptApi.getReceipt` и проверяется,
   что extra действительно есть (статус в настройках; при отсутствии — тост
   `PIVNIK ⚠ клиент не сохранился в чеке`). После закрытия/удаления связка стирается.

7. **Нет интернета / backend лежит.** Таймауты 3 с, без редиректов, только https. Любая ошибка
   → тост `PIVNIK: нет связи — продажа без привязки`, связка не создаётся, продажа идёт как обычно.
   Сканирование отвечает кассе мгновенно, сеть — только в фоновом потоке.

8. **Отмена чека.** `evotor.intent.action.receipt.sell.CLEARED` (`ReceiptDeletedEvent`) →
   связка удаляется; `OPENED` другого чека → устаревшая связка удаляется. На следующий чек
   клиент не переносится.

9. **Permissions / сервисы / receivers.** `INTERNET`,
   `ru.evotor.permission.SELL_INTEGRATION_SERVICE`,
   `ru.evotor.permission.RECEIPT_DISCOUNT_REQUIRED_EVENT`,
   `ru.evotor.permission.TRIGGER_RECEIPT_DISCOUNT_EVENT`; `<queries>` на провайдеры
   `ru.evotor.evotorpos.receipt` / `ru.evotor.evotorpos.v2.receipt`; meta‑data `app_uuid`.
   Сервисы `PivnikSellService` (BARCODE_RECEIVED), `PivnikReceiptService` (receiptDiscount,
   receiptDiscountRequiredEvent, beforePositionsEdited); receiver `PivnikReceiptReceiver`
   (OPENED, CLEARED, RECEIPT_CLOSED); `SettingsActivity` — только для настройки владельцем.

10. **Структура.**
    ```
    evotor-bridge/
      app/src/main/java/ru/pivnik/evotor/
        core/            чистая Java без Android: формат QR, политика связки, JSON extra, разбор ответа
        Bridge.java      фоновая логика скана, резолв, trigger
        PivnikSellService.java      скан
        PivnikReceiptService.java   SetExtra
        PivnikReceiptReceiver.java  жизненный цикл чека, проверка закрытого чека
        PivnikApi.java / BridgeSettings.java / PrefsBindingStore.java / SettingsActivity.java
      app/src/test/…    JVM‑тесты core
    ```

11. **Ссылки на документацию** — таблица выше.

12. **Изменения backend.** Существующего API недостаточно для автономной кассы (нет учётки
    устройства; device‑auth из `feature/kiosk-shifts` не в main и подключается через
    `apply-*.mjs`). Минимальный контракт описан в `BACKEND-CONTRACT.md`, **не реализован**.
    Импорт чеков (`feat/evotor-sales-dashboards-20261002`) сейчас выбрасывает extras — ему
    нужно читать `pivnik_user_id`, тоже описано там.

## Пограничные случаи

| # | Случай | Поведение |
|---|---|---|
| 1 | Штрихкод товара | не совпал со строгим форматом → `null`, касса работает как без приложения |
| 2 | QR PIVNIK | связка с текущим чеком, тост `PIVNIK ✓ Имя` |
| 3 | Второй QR того же клиента | `ALREADY_BOUND`, тост повторно, ничего не меняется |
| 3a | Второй QR другого клиента | не заменяет; тост «чек уже за X, отсканируйте ещё раз»; тот же новый QR повторно в течение 20 с → замена |
| 4 | Неверный / отозванный QR | тост «QR не найден», продажа продолжается |
| 5 | Нет сети / 5xx / 429 | тост, продажа без бонусов, касса не блокируется |
| 6 | Отмена чека | CLEARED → связка удалена |
| 7 | Следующий чек | OPENED другого UUID → связка удалена; extra пишется только по совпадающему UUID |
| 8 | Возврат | возвраты не вызывают SellIntegrationService и sell‑события; extra не пишется |
| 9 | Падение приложения | все обработчики ловят исключения и делают skip/`null`; касса продолжает без extra |
| 10 | Один QR на два чека | связка привязана к одному UUID и стирается при закрытии |
| 11 | Повторная доставка | идемпотентность — на backend по id документа Эвотора (см. контракт) |

## Что нужно проверить на реальной кассе (до любого использования)

1. `ReceiptDiscountEventResult` с `discount = 0` не меняет итог, в т.ч. при ручной скидке
   кассира. В исходниках семантика нуля не документирована.
2. Что касса показывает, когда на скан PIVNIK возвращён пустой `Result` (нет ли окна «товар не
   найден»).
3. `triggerReceiptDiscountEvent` работает на установленной версии ПО кассы и с выданными
   permissions (коды ошибок логируются в статус).
4. Extra есть в `header.extra` закрытого чека **и** в документе облачного REST API (в каком
   виде и под каким ключом — по app uuid). Нужен реальный обезличенный JSON.
5. Ответ на `ReceiptDiscountRequiredEvent` не вызывает лишних диалогов у кассира.
6. Терминалы на Android < 6 (API 23) не поддерживаются библиотекой.

## Проверка критерия успеха

1. Установить debug‑APK (артефакт CI `pivnik-evotor-bridge-debug-apk`) на тестовую кассу,
   собрав с реальным `EVOTOR_APP_UUID`.
2. В «PIVNIK для Эвотора» указать https‑адрес **тестового** сервера и токен сессии
   тестового сотрудника (только тестовый режим).
3. Открыть чек → добавить товар → отсканировать QR тестового клиента → тост `PIVNIK ✓ …`.
4. Оплатить (наличные и карта отдельно) → в настройках статус `closed <uuid> extra OK`.
5. Проверить документ в облаке Эвотора: есть `pivnik_user_id`.
6. Новый чек без скана → статус/документ без `pivnik_user_id`.
7. Повторить с отменой чека после скана и с возвратом.

## Сборка

APK собирается только в GitHub Actions (`.github/workflows/evotor-bridge.yml`): JitPack и
Google Maven из среды разработки недоступны. Core‑логика (`core/`) проверяется JVM‑тестами.

## Безопасность

QR — идентификатор, а не доказательство покупки. Приложение не отправляет на сервер суммы или
товары. Любое будущее начисление бонусов — только по подтверждённому закрытому документу из
облака Эвотора, с идемпотентностью по id документа. Токен сессии сотрудника в настройках —
только для теста; в production его заменяет ключ устройства (контракт).

# SPACEVERSE CRM — честная проверка готовности сайта

18 октября 2026. Следующий срез после directory: ветка
`spaceverse/crm-readiness-20261018`, основана на локальном `3a18a17`.
Отдельный PR пока не открыт: #284 всё ещё ожидает разрешения на merge.
Это проверка готовности, **не реализованная активация или подписка Маркета**.

## Что видит владелец

В существующем мастере подготовленного заведения появляется блок
«Что осталось для запуска CRM» с кнопкой «Проверить готовность CRM».
Проверка показывает клиентские данные, состояние последней проверки кассы,
подписку и запуск. Никакого автоматического чтения при открытии формы.
Новые вкладки/инструменты ПИВНИКА не добавляются. Блок скрыт при выключенном
существующем `ADMIN_ENABLE_TENANT_CRM_READS` и для read-only viewer.

Список клиентов и блок готовности независимы. Пустая база с правильной
binding — доступный источник с нулём клиентов. Неработающий источник —
ошибка проверки; интерфейс не подменяет её успешным нулевым результатом.
Смена draft/company/venue/actor уничтожает состояние обоих блоков.

## Настоящий серверный контракт

`GET /api/admin/onboarding/drafts/{draftId}/crm/readiness`, без query parameters.
Только существующая signed Admin session, owner/manager выбранной области;
параметры `status`, `license`, scope и credentials не принимаются. Другие
методы запрещены. Используется тот же default-off flag и общий лимит
30/min/actor для readiness, списка и карточки.

Общий `tenant-crm-read.ts` повторно проверяет ownership/grant/frozen manifest
перед выдачей, выполняет настоящий scoped target read в
`REPEATABLE READ READ ONLY` с 5s timeout и требует metadata audit.
Directory SQL считает только явных tenant customers. Readiness не возвращает
имён, usernames, фото, кошельков, device credentials или отчётных сумм.
`readStatus=verified` относится только к выполненному чтению клиентского
источника, не к готовности всей CRM. `runtimeStatus=not_provisioned` сохраняется.

Payload v1 содержит `checkedAt`, `status`, `activationAllowed:false`,
`crmStatus:not_provisioned`, `guestApplicationRequired:false`, `checks`:

| check | Что действительно подтверждается |
| --- | --- |
| customer_data | Настоящий target read; status active только для этого источника, count как точная строка, dataState empty/available |
| provider | Состояние существующей зашифрованной настройки/последней проверки POS proxy v2, evidence=last_saved_verification |
| subscription | not_configured / market_contract_not_configured: актуальный адаптер установки/оплаты ещё не реализован |
| activation | pending / crm_activation_pending: включение canonical venue этим endpoint не выполняется |

Касса читается через прежний `getOnboardingPosProxy`; ключ проверяется штатным
secret box, сохранённый source — прежними проверками. Секрет не возвращается.
Новый GET не вызывает внешнюю кассу/провайдера и не отправляет тестовое событие.
Он честно показывает последнюю сохранённую проверку, не новую live verification.
Для свежего active provider дополнительно нужны code=confirmed, available
report (включая допустимые нули), timestamp проверки и события не старше
5 минут и не более 5 секунд в будущем. Пропавший report, старое событие,
неизвестный status/code или повреждённый secret не становятся успешной связью.
Для новой живой проверки остаётся существующая операция POS proxy verification.

Даже свежая касса и доступная база не включают CRM: лицензия/установка
Маркетом не проверены. Старый SDK, локальный флаг или browser assertion не
подменяют оплату. Запуск гостевого приложения сам по себе не объявлен
обязательным условием CRM; его состояние этим endpoint не меняется.

Audit `crm.readiness_check` содержит actor/company/venue/draft и purpose;
нет count, поиска, отчёта, PII и секретов. При ошибке audit результат не выдаётся.
Ошибки authorization/source/registry используют прежние 400/401/403/404/409/503;
ошибка связи не возвращает checks с ложным customerCount=0.

## Проверки

Из admin-platform:

```sh
npm test -- --maxWorkers=1 server/tests/tenant-crm-http.spec.ts server/tests/tenant-crm-readiness.spec.ts
npx playwright test -c playwright.tenant-crm.config.ts
SPACEVERSE_E2E_CRM_READS=false npx playwright test -c playwright.tenant-crm.config.ts
```

Для native HTTP/бразузерного контура нужен собственный loopback PostgreSQL
через SPACEVERSE_TEST_NATIVE_POSTGRES_URL, тот же fixture role/database prefix.
Никаких production URL. Readiness unit cases используют явно синтетическое
сохранённое evidence; encrypted-settings HTTP case сохраняет настоящий ключ
через штатные endpoints в test metadata, затем задаёт synthetic evidence на
границе внешнего провайдера. Это не отчёт о проверенной живой кассе.

Фактические результаты и ограничения записываются в
ops/SPACEVERSE-ONBOARDING-PROGRESS.md. До подтверждённого контракта, sandbox
оплаты/отзыва и реализации activation операция остаётся pending; кнопки
«Запустить» и утверждения о коммерческой готовности отсутствуют.

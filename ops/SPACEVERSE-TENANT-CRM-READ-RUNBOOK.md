# SPACEVERSE: проверка чтения клиента при подготовке CRM

18 октября 2026. Это первый Admin API adapter на существующий tenant customer/wallet repository, **не завершённая CRM и не активация заведения**. Точки существующего мастера должны оставаться `prepared`/неактивными. Новый endpoint работает только в этом контуре; активный CRM reader, список/поиск и UI — следующие шаги. Защита legacy reader ПИВНИКА не снимается.

## Предварительные условия

Только изолированный тестовый контур. Используются существующие canonical company/venue, подготовленный draft/application/scope и защищённый `ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON`. Целевой DB credential выбирает сервер по runtime key. Новые registry/tenant/ownership модели не вводятся. База ПИВНИКА не может быть target по прежним ограничениям registry.

В target заранее вручную применены штатная схема users/wallets, миграции 017/018/019 и записана соответствующая binding. Клиент имеет явную `spaceverse_customer_ownership`; историческая строка users/wallets без ownership недоступна. Endpoint не выполняет миграций, не создаёт клиентов и не присваивает им ownership.

Новый переключатель `ADMIN_ENABLE_TENANT_CRM_READS` **false по умолчанию**. Для тестового использования также нужны существующие onboarding drafts/writes flags; для приглашённого владельца/управляющего — invitations flag. Настройки production/Railway в этой итерации не меняются. При включённом переключателе startup проверяет существующий target registry.

## Реальный серверный контракт v1

`GET /api/admin/onboarding/drafts/{draftId}/crm/customers/{customerId}`

Авторизация — существующая Admin session cookie. Query parameters, credentials и company/venue/runtime scope не принимаются. Только чтение; POST/PUT/DELETE не поддерживаются, прежняя Origin-защита сохраняется. Лимит — 30 запросов/минуту на actor.

Доступ: собственный draft платформенного администратора, существующий owner компании либо manager с grant на конкретный draft/точку. Viewer и trusted без такого grant не получают клиентские данные. Сервер проверяет доступ к draft и повторяет проверку после чтения target; scope/manifest берёт из замороженной серверной конфигурации.

Пример формы ответа, **синтетические значения**:

```json
{
  "schemaVersion": 1,
  "scope": {"companyId": "10", "venueId": "101"},
  "readStatus": "verified",
  "runtimeStatus": "not_provisioned",
  "customer": {"id": "1", "username": null, "firstName": "Тест", "lastName": null, "photoUrl": null, "role": "client"},
  "wallet": {"balance": "0", "updatedAt": "2026-10-18T12:00:00.000Z"}
}
```

`wallet=null` означает отсутствие кошелька, а не нулевой баланс. Баланс — точная десятичная строка, не JS number; кошельки разных точек не суммируются. `readStatus=verified` подтверждает только чтение этой карточки через DB binding; не проверяет кассу, импорт, лицензию или production deployment. `runtimeStatus` остаётся `not_provisioned`.

Ошибки: 401 — нет session; 403 — выключено/нет разрешения; 400 — неверный ID/попытка задать scope; 404 — чужой/недоступный draft либо не принадлежащий точке клиент; 409 `TENANT_CRM_SOURCE_NOT_CONFIGURED` — нет зарегистрированного target; 503 — binding/схема/доступность/аудит не подтверждены. При неработающем target нет fallback в legacy БД и нет успешного нулевого ответа.

## Гарантии и проверка

- Используется исходный `customer-wallet-repository.js`; точная binding повторно проверяется тем же SQL, который читает ownership/users/wallets. Административный adapter не дублирует customer/wallet расчёт.
- Target читается в `REPEATABLE READ READ ONLY`; соединение возвращается, транзакция завершается или откатывается. В target нет write operations.
- Успешный доступ записывается в metadata audit как `crm.customer_read` с actor/company/venue/customer ID и purpose. Баланс, имена, секреты в audit payload не помещаются. Ошибка аудита не позволяет вернуть карточку.
- Database failures возвращаются без DSN/credentials. Legacy production tables не меняются; единственная новая запись рабочего пути — metadata audit, помимо штатного обновления Admin session.

Выполнить в `admin-platform/`: `npm test -- --maxWorkers=1 server/tests/tenant-crm-http.spec.ts`. По умолчанию тест поднимает настоящий HTTP router с login/session и одноразовые PGlite metadata + три target DB, использует существующие миграции. Покрывает две компании/две точки, одинаковые ID клиентов, foreign/unowned/deleted/staff, пустой/нулевой/большой кошелёк, отзыв grant во время чтения, подмену registry/source, ошибки и аудит, rate limit и запрет параметров scope.

Для native проверки тот же тест принимает `SPACEVERSE_TEST_NATIVE_POSTGRES_URL`. Разрешены только loopback host, database prefix `codex_admin_test`, роль `crm_fixture`. Helper создаёт уникальные physical databases для metadata/каждого target, пиннит pg client на транзакцию и сохраняет fixture databases для инспекции. Общий SQL seed не дублируется. URL задаётся только для собственного изолированного контейнера, никогда production. `ADMIN_INTEGRATION_TEST_DATABASE_URL` включает прежний native suite в отдельной исходной test DB; он пересоздаёт только её synthetic schema.

На PostgreSQL 16 выполнены `server/tests/postgres.integration.spec.ts` + `server/tests/tenant-crm-http.spec.ts`: **39 passed / 0 skipped**. Новый case дополнительно подтверждает `SHOW transaction_read_only=on` на том же соединении. Docker build с session CA mount (strict-ssl=true) и `VITEST_MAX_WORKERS=1` выполнил typecheck/lint, 291 tests (+20 native skipped внутри image build), 170 security tests и build. Команды/assertions/timeouts production Dockerfile и CI не менялись; worker env нужен для CPU-квоты среды. Отдельные 39 native tests покрывают pg-driver, пропущенный внутри герметичной image сборки.

Собранный image проверен в production mode на собственном PostgreSQL: HTML/health, настоящий login/secure cookie, default-off 403; затем opt-in — настоящий registry и три target DB, границы company/venue/manager, 0/null/bigint и запреты scope/POST. Это тестовый запуск внутри среды разработки, не production deploy и не кассовая проверка. Настоящий TLS/CA внешнего DB endpoint, касса/Маркет, browser flow нового endpoint и коммерческая CRM ещё не проверены. Следующий срез — безопасный список/поиск и интеграция в существующий UI; активация требует отдельного изменения существующего lifecycle.

# CHAT 02 — checkpoint #13: reciprocal cross-company CRM reads

**Дата:** 2026-11-01
**Состояние:** тестовый срез в изолированной Draft-ветке, до ревью координатором.
**База:** `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
**Предыдущий пункт:** #12, Draft PR #339 `a907f8c2`; GitHub Actions release gate run `41266789285` завершился `success` (включая `npm test`, Business Vitest, двойную materialize, `npm run check` и production dependency audit). PR остаётся Draft, без merge.

## Проверенные сведения

- `admin-platform/server/tenant-crm-read.ts` выбирает источник по авторизованному сохранённому draft; до доступа к DB проверяет `onboardingDraftAccessSql` и `loadOwnedOnboardingRuntimeSource`; повторно проверяет grant и manifest перед отдачей PII; target открывает в `REPEATABLE READ READ ONLY`; флаг `enableTenantCrmReads` по умолчанию выключен.
- `admin-platform/server/tests/tenant-crm-fixture.ts` использует **три физически изолированных** target database (company 10 / venue A, company 10 / venue B, company 20 / venue C), одинаковый `users.id=1`, разные баланс-значения 101, 102, 103, явные ownership bindings.
- В main `tenant-crm-http.spec.ts` уже тестирует owner company 10 -> foreign company 20 = 404, same customer ID, чужой runtime registry, PII, аудит, revocation, rate limit и ввод scope-аргументов.
- Ветка параллельного CHAT 03 `spaceverse/chat03-crm-tenant-list-20261101` **уже меняет** `tenant-crm-http.spec.ts`, `router.ts`, `tenant-crm-read.ts` и `MODULE-MAP.md`; их **не трогать**, не дублировать задачи CRM directory/sorting/UI.
- Пункт #13 требует явно проверить *оба* направления между компаниями и отсутствие даже попытки подключения к чужому источнику.

## Изолированная добавка

Один новый тест `admin-platform/server/tests/tenant-crm-cross-company-read.spec.ts`:
- Настоящий локальный HTTP `router.ts` и signed cookie sessions владельцев company 10 / company 20; миграции/metadata и target DB только в PGlite fixture.
- Положительный контроль: каждый владелец читает своего customer ID 1 и видит свой баланс (101 против 103).
- Отрицательные: owner(10) -> чужой draft(20), owner(20) -> draft(10) и его второе venue; для каждого: profile, directory search и readiness = HTTP 404 / `ONBOARDING_DRAFT_NOT_FOUND`.
- Проверяется отсутствие чужих данных в error и строгая неизменность числа вызовов `resolveTargetDatabase` и SQL target; подставленные query companyId на own draft дают HTTP 400 до target resolution.
- Никаких изменений runtime/роутов/текущих тестов CHAT 03/миграций/БД production; только новый файл + этот checkpoint.

## Gates и пределы утверждения

1. `npm test --prefix admin-platform` / focused Vitest: проверить итог CI на текущем commit, в особенности новый файл.
2. `npm run materialize` дважды (идемпотентность), `node --test` / `npm test`, `npm run check`, аудит зависимостей на той же ветке; отдельно CI.
3. **Это HTTP + PGlite, а НЕ native PostgreSQL production**. Native PostgreSQL + отрицательные HTTP/DB тесты относятся к #20, только на выделенном тестовом кластере `crm_fixture`, не production.
4. Протестирован только **default-off preparation reader**; active customer CRM и произвольные privileged endpoints не объявлять защищёнными только по результату этого теста.
5. Перед merge — coordinator CHAT 01, свежий main, сравнение ветки CHAT 03, регрессия, отдельное решение по включению флагов; никаких merge/deploy в CHAT 02.

**Уже лично выполнено:** remote main/PR/CI/MODULE-MAP/параллельная ветка CHAT 03 проверены; один тестовый файл добавлен в отдельную ветку. **Локальных npm/PG/live HTTP запусков нет:** текущий container не является checkout. CI-результат фиксировать отдельно по реальному run.

**Следующий пункт:** #14 — негативные мутации CRM чужой компании; перед началом повторно проверить main/CHAT 03 и тесты; шаг #13 не считать завершённым до зелёного CI.

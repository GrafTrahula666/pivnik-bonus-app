# CHAT 02 / задача #14 — двусторонние negative CRM mutations

**Дата:** 2026-11-01. **Режим:** автономная работа только в isolated Draft PR, без merge/deploy/production reads или writes.
**Проверенная база:** `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.

## Preflight (GitHub, read-only)
- Повторно проверены `ops/MODULE-MAP.md` / Do not break 1282–1313, актуальные main, PR #339/#360 и ветка CHAT 03 `spaceverse/chat03-crm-tenant-list-20261101` (в ней изменяется `tenant-crm-http.spec.ts`, `router.ts` и CRM reader; эти файлы **не менять**).
- На main `tenant-crm-read.ts` обслуживает **только GET** клиент/список/readiness default-off подготовительной CRM; write API для tenant customer там нет, попытка POST/PUT отвергается 405. Не утверждать, что такой write API протестирован.
- Действующие CRM mutation routes находятся в `admin-platform/server/router.ts`: `/api/admin/venues/:venueId/clients/:customerId/bonus-adjustments`, `entitlements`, `cashback`, `achievements/grant`, `app-achievements`, `frames`, revocation. Перед любым writer router выполняет `resolveVenueScope`, CSRF, `requireVenueAccess`. `buildVenueScopeQuery` проверяет `admin_company_access` против company of venue, а не query/body. Денежный `bonus-pilot-writer.ts` дополнительно ограничивает применение mapped PIVNIK.
- `venue-onboarding.ts` выполняет authenticated + SQL grant проверки перед обновлением `admin_onboarding_drafts` и `admin_onboarding_app_configs`; роль owner выдаётся по правильному `company_id`, не по наличию валидного UUID.

## Выполненный срез
Новый независимый тест `admin-platform/server/tests/tenant-crm-cross-company-write.spec.ts`:
- Локальный signed HTTP router и disposable PGlite metadata с existing `seedOnboardingFixture`: активные venues company 10 / 20, два отдельных владельца, один и тот же ID клиента.
- Положительный контроль: owner(10) видит только venues 1/2, owner(20) только venue 3. Сессии и CSRF получены через login, не подделаны.
- 7 типов реальных CRM mutation endpoints в **обоих направлениях** чужих company/venue: HTTP 404 `VENUE_NOT_FOUND`; проверки snapshot до/после исключают изменение `wallets`, `transactions`, `admin_onboarding_drafts`, `admin_onboarding_app_configs`.
- `PUT /onboarding/drafts/:id` и `PUT .../application` для чужого company draft в обоих направлениях: HTTP 404 `ONBOARDING_DRAFT_NOT_FOUND` + metadata snapshot unchanged.
- Только новый тест и этот checkpoint; никакие приложения, маршруты, SQL migrations, env/secrets, денежные writers, устройства, production не изменяются.

## Проверки / границы утверждения
- Root `npm run materialize` ×2, `node --test`, `npm run check`, Business `npm test --prefix admin-platform`, dependency audit: **ожидают CI exact head**, не выдавать за лично локально запущенные команды.
- Контейнер этой сессии **не имеет локального git checkout**, поэтому local npm / native PG / running production HTTP / реальная касса не тестировались.
- Native PostgreSQL и реальные инварианты wallet/operation/bonus между company/venue требуют отдельных задач #16 и #20.
- Tenant CRM preparation оставлена default-off, не утверждать tenant write support у неподключённого API. Результат касается доступа к реально существующим venue/onboarding mutations, а не будущего arbitrary-customer write API.
- До ревью координатором CHAT 01, отдельной регрессии на fresh main и согласованного релиза: Draft, no merge/deploy.
- После успешного CI можно готовить задачу #15: две точки одной компании и различие company owner vs venue invitation role. Не перепрыгивать без проверки результата #14.

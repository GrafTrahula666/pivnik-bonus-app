# CHAT 02 — checkpoint #14: cross-company CRM mutation denial

**Дата:** 2026-11-01
**Очередь:** 11–13 подготовлены в отдельных Draft PR; текущий единственный шаг — **#14**.
**База:** `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
**Ветка:** `test/chat02-cross-company-crm-mutation-20261101`.
**Тестовый commit:** `04049f7737e150548f45472ddf27c258ae734624`.
**Draft PR:** [#366](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/366).
**Предыдущий checkpoint:** #13 [Draft PR #360](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/360), head `2b7c09cc51abc1037c87b960fc50df1cf8e5036c`; release gate, Business cash browser check, CRM beer inventory native PG workflows все `completed/success` (проверено через GitHub API). #360 не merged.

## Проверка перед изменением

- Загружены `pivnik-preflight` и references; прочитан `ops/MODULE-MAP.md`, включая Do not break. Main и соседние PR/ветки проверены через GitHub.
- CHAT 01 завершил документальный GO/NO-GO с [Draft #363](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/363); решение COMMERCIAL NO-GO, никаких указаний на merge/deploy.
- CHAT 03 работает над tenant CRM directory в `spaceverse/chat03-crm-tenant-list-20261101` и [Draft #359](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/359). Его `router.ts`, `tenant-crm-read.ts`, `tenant-crm-http.spec.ts` и `MODULE-MAP.md` не изменялись.
- `admin-platform/server/tenant.ts:resolveVenueScope` получает venue только через `admin_company_access` и active company/venue. `router.ts` разрешает venue scope до проверки CSRF и чтения тела mutation; `requireVenueAccess` отдельно проверяет метод и роль.
- Текущий independent tenant CRM customer API `/api/admin/onboarding/drafts/:draftId/crm/customers/:id` поддерживает только GET и отклоняет все остальные методы с 405. Независимого tenant CRM write API в проверенном main нет. PIVNIK bonus writer default-off и отдельно gated.

## Единственный изолированный diff

Новый `admin-platform/server/tests/tenant-crm-cross-company-mutation.spec.ts` (151 строка), без изменений runtime:
1. Две компании 10/20, venues 101/202 и два owner grant; HTTP router, реальные логины, подписанные cookies и CSRF, disposable PGlite metadata.
2. Положительный контроль: каждый owner видит только собственный venue.
3. В обе стороны чужой venue ID: POST bonus/entitlement/achievement/frame, PUT cashback, DELETE frame — 404 `VENUE_NOT_FOUND`, до доступа к writer.
4. Malformed JSON на чужом bonus endpoint тоже 404: scope проверяется раньше body parsing.
5. POST/PUT/DELETE independent tenant CRM customer endpoint — 405 `METHOD_NOT_ALLOWED`, никакого ложного обещания о доступных tenant CRM writes.
6. Собственный bonus endpoint при `ADMIN_ENABLE_WRITES=false` — 405 `WRITES_DISABLED`. Writer заменён тестовым sentinel, production connection count = 0; в audit нет неавторизованных изменений.

## Проверки и ограничения

- **На момент создания checkpoint:** код отправлен в Draft PR; GitHub CI для `04049f77` ещё не появился в `fetch_commit_workflow_runs`. Ни один тест для нового commit **не объявляется прошедшим**.
- Локального checkout/dependencies в текущем runtime нет: `npm test --prefix admin-platform`, `npm run materialize` ×2, `node --test`, `npm run check`, `npm audit` здесь **не запускались**. GitHub CI и его точный SHA нужно проверить отдельно.
- HTTP + PGlite **не равно** native PostgreSQL / browser / live E2E. Пункт #20 предусматривает native PG negative tests на выделенном `crm_fixture` кластере. Текущие тесты не доказывают безопасность будущих независимых CRM mutations.
- Никаких production data writes, секретов, миграций, root `server.js`/`universal-server.js`, чужих веток, merge/deploy. Паритет дублированных root routes не затронут.
- Риск: P1, если новая mutation endpoint в будущем обойдёт canonical scope. До появления write API не разрешать её включение на основании этих тестов.

## Следующий точный шаг

**Продолжить #14, пока CI PR #366 не подтверждён:** получить GitHub Actions runs/jobs на текущем head, при красном focused Vitest исправить только этот новый тест в этой же ветке и повторить; при зелёном зафиксировать evidence и передать Draft координатору CHAT 01. Только затем перейти к #15 (два venues одной компании и точечные grants), без merge/deploy.

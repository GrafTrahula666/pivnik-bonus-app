# Admin Pilot → Эвотор.Маркет: состояние и продолжение

Дата: 23 октября 2026. Ветка `spaceverse/evotor-market-20261023`.
База `origin/main`: `0dd84af1431db65ded266715c6cf4369c7a318cf`.
Код и тесты: commit `708b5724f3f035f09e080311dfa8bc9e01309a92`.
Draft PR: [#299](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/299).
**Статус продукта: не готов к коммерческому выпуску; публикация не выполнялась.**
Процент готовности не используется: ниже проверяемые функции и ограничения.

## Почасовой P0.1 security slice — конфликт владельца subscription (25 октября 2026)

В существующем [Draft #299](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/299)
исправлен отдельный fail-open риск: ранее новый `sequenceNumber` с тем же
`subscriptionId`, но другим provider `userId`, отклонялся 409 с ROLLBACK.
При этом прежняя subscription могла остаться в `active`, без sticky hold.
Теперь такой конфликт сохраняет пришедшее событие как доказательство и
атомарно переводит ИСХОДНУЮ subscription в `review_required` с
`reconciliation_required=true` **до** 409. Ошибка COMMIT даёт 503 и откат;
повтор и последующее корректное событие не снимают hold. Отдельная original
user row намеренно не блокируется в этом пути во избежание межпользовательского
deadlock; будущий license gate обязан проверять subscription-level hold.
Это не лицензия, не tenant binding и не включение платного доступа.

Код: [5c928e4](https://github.com/GrafTrahula666/pivnik-bonus-app/commit/5c928e467224a2fc151cf59b57fb7ef028d8945f).
Регрессия: [5f48317](https://github.com/GrafTrahula666/pivnik-bonus-app/commit/5f483174b85f48ab4f7aa8d11fcb1d9096dd9480)
проверяет original owner, atomic COMMIT failure, retry и невозможность
очистить hold. Runbook и MODULE-MAP обновлены. **CI для нового head
ожидается; локальные materialize×2, root tests, Admin native SQL и E2E в
текущем окружении не запускались**. Результаты прежних SHA ниже не являются
результатами этого изменения. Без merge/deploy/production migration.

## Агент №1, 25 октября: uncached store verification (Draft #302)

Добавлен `cache: 'no-store'` для каждого запроса GET `/stores` в read-only
adapter; регрессионная проверка фиксирует этот режим на всех страницах.
Это только требование к HTTP fetch, **не доказательство свежести/владения**:
до binding по-прежнему необходимы canonical owner proof, повторная проверка
provider user/token revision, актуальные ACL и разрешённый тестовый API flow.
На момент изменения GitHub не показал CI для нового head; локальный shell
недоступен, тесты этой итерации не запускались. PR #302 отстаёт от #299,
синхронизация нужна отдельно до интеграции. Без merge/deploy/live calls.

## Следующий независимый этап25 октября — P0.2 store evidence

Ветка `spaceverse/evotor-store-ownership-20261025`, [Draft #302](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/302) поверх #299.
Код этого этапа: [10218e2](https://github.com/GrafTrahula666/pivnik-bonus-app/commit/10218e2d2cd68ae78c4a41b83a188971fb345f74).
GitHub browser CI #299 на fa5cec9: success (run40149963628); release gate на момент записи ещё выполнялся. CI #302 проверяется отдельно.
База — [inbox hardening fa5cec9](https://github.com/GrafTrahula666/pivnik-bonus-app/commit/fa5cec97dbcab208816cd7df50d84ca291a4c03a),
[Draft #299](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/299).
Реализация: новые `evotor-market-stores.ts` +44 проверок; MODULE-MAP/runbook
в том же scope. Не смешивается с #296, #300, POS или денежной интеграцией.

Делегированный инженер создал adapter и43 теста, подтвердил официальный Bearer/
v2 headers. Координатор лично прочитал код/источники, потребовал exact200 вместо
любого2xx, добавил206 regression и выполнил итоговую верификацию. Независимое
read-only review не нашло blocking/must-fix. Результат возвращается только после
полной пагинации и проверки каждого owner; redirect/foreign/duplicates/timeout/
byte/page caps не дают частичного успеха. Error text/token не раскрываются.

Проверки координатора итогового candidate:
- Focused HTTP inbox15 + stores44 = **59/59 PASS**, synthetic/PGlite/fake transport.
- Business full: **499 pass/21 skip/0 fail**,41 files;21 native PostgreSQL skip
  остаются непроверенными. Typecheck/build/lint/isolation PASS,13 прежних lint
  warnings и прежний chunk warning. Собственных DB writes этот adapter не имеет.
- Root на базе main6ec4350: **656/656 PASS**, check PASS, materialize×2 SHA256,
 7 generated diffs восстановлены. Root/Admin full+prod audits:0 vulnerabilities.
- Desktop/mobile regression ранее в этой же сессии: **24/24 PASS**; frontend
  этим adapter не меняется. Native PostgreSQL и real-provider E2E заблокированы
  окружением/тестовыми доступами; имитация не считается живой установкой.

**Доступно только как Draft-модуль:** adapter не mounted, не вызывает провайдера
в production, не записывает binding/лицензию/tenant activation. Нет нового env,
миграции, платного API или зависимости. Одноразовый canonical owner proof,
consumer с повторной проверкой token revision/grants, terminal allocation и
runtime license gates всё ещё не реализованы. P0.2 в целом НЕ закрыт.

Для продолжения account flow нужны подтверждённые настройки test app/user/verify
и разрешённый test user/store/terminal. Нельзя принимать произвольный userId
или полный список stores за право на компанию SPACEVERSE. Лицензии дополнительно
ждут утверждённых product/plan/addon/trial/expiry правил и reconciliation источника.
Не снимаются existing legacy guard и `market_contract_not_configured`.
#296 уже содержит проверяемую подготовку пустой target-схемы; без разрешённого
ресурса DB/owner/license его нельзя выдавать за активный клиентский SaaS путь.

## Продолжение 25 октября 2026 — P0.1, только Draft #299

**Авторитетен этот новый раздел; результаты 23 октября ниже — история, не новый прогон.**
Мандат: разработка/коммиты/Draft PR; без merge main/deploy/production migrations,
финансовых операций и публикации. Прочитаны вложенные правила/starter pack/CRM
knowledge base, PIVNIK preflight/core, MODULE-MAP Do not break и целевые runbooks.
GitHub и свежий clone подтвердили первоначальный main `019237ad2cf3d439201d612ebda1282755ad2dfa`,
#299 `efae6eef9406ff68bfa478c5f0adfd7b45c89ff5` и #296
`4d75b856dbd607036f2c1e46204ecff02249148e`: оба открыты/Draft. Просмотрены origin
heads, история и 50 открытых PR. #300 — отдельный дизайн/периоды; не импортирован.
Перед публикацией main изменился: отдельно авторизованный владельцем чужой
security PR #301 уже merged (`6ec4350b1ad6d8f115421bed9282c8c63cf4ec15`).
Его body-parser1.20.9 импортирован синхронизацией main и лично перепроверен,
не присваивается этой сессии. Финальная база — этот SHA; чужой дизайн сохранён. #296 не импортирован:
его database bootstrap — отдельный этап; готовая схема ещё не активная CRM.

Действующее списание бонусов в баре подтверждено владельцем; в main есть merged
#297 (`16be997`, `6b7772a`) с redemption/recovery. Код и тесты существуют; это
не новый реальный денежный тест и не подтверждение production configuration.
Старое «списание pending» не используется как статус работающей кассы.

Лично реализовано координатором:
- Сохранение конфликта callback до409 с атомарными sticky holds на исходном
  provider user/subscription; только digest изменённого payload, без его текста.
- Запрет перехода terminated → termination_requested → active.
- Manual additive Admin019; миграции/root POS/bonus/VK/TG/kiosk не менялись.
- Тесты replay/подмены userId/конкуренции/отзыва-переустановки/ошибок COMMIT и
  документация. Подписка остаётся metadata projection, не лицензией.

Независимый subagent проверил diff read-only: blocking P0/P1 не нашёл;
его focused15/15 PGlite не подменяет проверки координатора. Другой subagent
проверил официальные контракты: app/user discrepancy остаётся. Следующий
независимый P0.2 store adapter ведётся отдельным scope/PR, не включён сюда.

Проверки координатора на итоговом P0.1:
- materialize×2: SHA256 совпали для954 tracked files на новой базе; 7 исторических generated
  файлов восстановлены побайтово и в commit не входят. Patch-chain не менялась.
- `node --test`: первый прогон654 pass/1 file failure (POS proxy), отдельный
  повтор этого файла5/5; полный повтор `--test-concurrency=4`:655/655;
  после нового main/security lockfile финальный повтор: **656/656, 0 skip**.
  Первый провал не засчитан успешным. `npm run check`, VK parity/bundle PASS.
- Business typecheck/build/lint/isolation PASS. Lint13 прежних Fast Refresh
  warnings после синхронизации main; существующий chunk warning сохранён.
- Business Vitest: **455 pass, 21 skip, 0 fail** (40 files). Пропуски — native
  PostgreSQL integration без разрешённого тестового URL, не успех этих тестов.
  Общий финальный candidate с независимыми44 store-adapter tests: **499 pass,
  21 skip, 0 fail** (41 files); эти дополнительные44 теста относятся к следующему
  отдельному PR, а не к функциональности inbox #299.
- Focused inbox HTTP/SQL PGlite: **15/15 PASS**. Native PostgreSQL не проверен:
  Docker/psql отсутствуют; подготовленный временный пакет PG не запущен, среда
  запрещает отдельный OS user (`runuser: Operation not permitted`). Production
  URL/БД не использовались. Cross-user native lock/deadlock test остаётся gate.
- Playwright desktop/mobile: cash/scope12 + CRM pagination12 = **24/24 PASS**.
  Это synthetic browser regression, не provider installation E2E.
- Root audit первоначально выявил1 high body-parser GHSA-27r3-jxmh-p828.
  После независимого merged #301, exact npm ci и повтора root full/prod audit:
  **0 vulnerabilities**. Business full/prod audit: **0 vulnerabilities**.
  Зависимость исправлена другим агентом в #301, не этим inbox изменением.

| Gate | Статус 25 октября | Следующее доказательство |
|---|---|---|
| Callback inbox | P0.1 hardening проверен локально, Draft | native SQL + реальный auth/повторы провайдера |
| Canonical business/store binding | Не реализован | owner proof + подтверждённый account flow, текущие grants, проверенные stores/terminal |
| Лицензия/runtime enforcement | Не реализован | согласованный тариф/период/allocations + полная reconciliation |
| Независимая CRM activation | Не закрыт; #296 отдельный Draft | ресурс тестовой БД + owner binding + license path; не снимать legacy guard |
| Релиз | BLOCKED | native/provider E2E, legal/moderation и отдельное разрешение выпуска; audit high закрыт чужим #301 |

Требуется от владельца/Эвотора: разрешённый тестовый app/account/store/terminal,
подтверждённый callback auth/account flow и коммерческие правила. Секреты —
через защищённые настройки. Повторные реальные денежные тесты не проводятся.
Следующий минимальный шаг: отдельный bounded read-only store verifier, затем
подтверждённый owner proof; не принимать userId за право на canonical компанию.

## Preflight и полномочия

- До изменений working tree чистый, локальная ветка `work`; `git fetch` подтвердил
  совпадение с origin/main. Создана отдельная ветка; main не изменяется.
- Прочитаны PIVNIK Preflight/core, актуальные части MODULE-MAP и Do not break,
  существующий SaaS audit/roadmap/progress. AGENTS.md в checkout не найден.
- Просмотрены origin heads и открытые PR (`gh pr list --state open --limit100`);
  `admin-platform/production-pilot` = `6b97192`, staging-qa = `cb3e7cb`.
  Они не доказывают версию действующего production deployment.
- Открытый #298 относится к motion polish, не к callback integration. Старый
  merged #103 добавлял пагинацию root CRM, а не React ProductionCRM; его код
  не импортируется. Существующие открытые draft implementations не присваиваются.
- Railway plugin отвечает `UNAUTHORIZED / requires reauthentication`; CLI
  Railway в среде отсутствует. Реальный source branch/root/deployed SHA и
  presence production secrets не проверены. Значения секретов не читались.
- Публичные read-only `/api/admin/health` и `/api/admin/auth/session`: HTTP200,
  `ok=true`, unauthenticated, demo=true, invitations=false. Это не signed workflow
  и не доказательство tenant onboarding или версии. Сайт не изменялся.
- Полномочия: локальная разработка/тесты/коммиты/draft PR. Нет merge/deploy,
  production migrations/data writes, кассовых операций, публикации, киоска.
- Read-only main branch protection API вернул403 (`Resource not accessible by
  integration`); обязательные review/status gates не подтверждены и не менялись.

## Сделано в этой сессии

| Задача | Реализация / доказательство | Граница |
|---|---|---|
| Callback токена Эвотора | `server/evotor-market.ts`, AES-GCM existing keyring + scoped AAD, idempotent token revision | Последний доставленный token не равен доказанно актуальному; provider verification отсутствует |
| Install/uninstall | Durable event ID/hash, timestamp ordering, equal-time ambiguity, product check | Не активирует/не отзывает CRM ACL: binding/authorizer ещё отсутствуют |
| Subscription inbox | Exact official types, conditional schemas, contiguous sequences, replay/conflict/user binding, gaps, backlog >1000 | Проекция фактов не коммерческая лицензия и не entitlement |
| Сохранность metadata | Manual additive018, row locks, transaction before200,503+rollback on storage failure | Не применялось к production, no schema startup |
| B2B auth isolation | Only configured app Authorization, enabled=false hides routes; browser Origin/CSRF retained | Official app/user auth discrepancy needs provider test |
| Login abuse | Pair6 + IP30 + normalized account15 per15m, before SQL/scrypt; 7 new tests | Process-local, ingress/distributed protection not proved |
| Полная CRM pagination | 100/page, filter reset, current-path result, accessible controls, scope/late-response tests | Existing legacy PIVNIK reader; не новый универсальный tenant reader |
| Денежная сортировка CRM | Typed balance/spend/timestamp SQL + id tie breaker; native205-customer and9/20/100 tests | Offset pages не snapshot при конкурентных изменениях базы |
| Dependency security | Vitest pinned4.1.12, lockfile; current full/prod audit zero | Audit зависит от доступной базы advisories на момент запуска |
| Материалы Маркета | Runbook, official references, card text, price proposals, developer checklist | Draft, без выдачи future функций за доступные; not submitted |

Координатор реализовал inbox/migration/mount, native SQL сортировку и проверку,
документацию/регрессию. Agent A исследовал официальные контракты; Agent B сделал
login limits и UI pagination в выделенных файлах; Agent C проверил дефекты и
отдельно выполнил smoke собранного runtime. Ранее существовавшие CRM/onboarding/
POS/tenant registry не считаются результатом этой сессии.

## Проверяемая матрица продукта

| Приоритет / обязательный сценарий | Сейчас | Следующее доказательство / блокер |
|---|---|---|
| P0 Auth/session/CSRF/tenant ACL | Local regression PASS | Signed production workflow/deployed version не проверены |
| P0 Независимый tenant без legacy leakage | Existing prepared CRM diagnostics, isolated SQL tests PASS; полная активация PARTIAL | Canonical binding + approved activation/license path; legacy guard не снимать |
| P0 Установка из Маркета | Callback HTTP+SQL PASS, live BLOCKED | Тестовое приложение/аккаунт/магазин/терминал, подтверждённый event auth |
| P0 Привязка user/store к company/venue | NOT IMPLEMENTED | Подтверждённое proof-of-ownership из выбранного account/install flow; не присваивать компанию по строке userId |
| P0 Лицензии/доступ/отзыв | Inbox PARTIAL; runtime enforcement NOT IMPLEMENTED | Plan/device allocation, expiry/trial/refund/grace, current provider state, server gates всех CRM/AI APIs |
| P0 Денежные показатели | Existing reports + numeric sorting tests PASS locally | Полный real test import SELL/PAYBACK/replay/returns/incomplete history, exact store scope |
| P1 Авторизация/регистрация/подключение компании | Login/invitations/prepared wizard существуют; self-service PARTIAL | Полный путь нового коммерческого клиента без оператора |
| P1 CRM/клиентская база | Existing legacy + prepared reader; paging PASS | Общий contact CRUD/consent/identity binding и активный независимый CRM reader |
| P1 Продажи/товары из Эвотора | Existing scoped import/report code; callback metadata добавлены | Real authenticated test contour; не писать собственный stock/accounting |
| P1 Поддержка/backup/restore | Existing default-off internal support queue | Разрешённый эксплуатационный restore drill, support/legal owner choices |
| P2 Аналитика/mobile | Existing cash charts + browser regression; pagination desktop/mobile PASS | Acceptance нового tenant на разрешённом стенде |
| P3 AI отдельная опция | Архитектура существует; внешний provider/платные вызовы отсутствуют | Реальный отдельный entitlement, scoped tools, usage/budget, outage gate; до этого не продавать |
| Release/legal/карточка | Draft package | Издатель/договоры/контакты/privacy/SLA,3 actual screenshots, tariff agreement, moderation |

Наличие callback inbox не закрывает строку лицензии или CRM activation.
`tenant-crm-readiness.ts` намеренно продолжает возвращать
`market_contract_not_configured`. Unknown/failed связь не становится нулевой
выручкой или active tenant. Работу стороннего SaaS нельзя включать через снятие
`requireLegacyBar` либо подстановку ПИВНИК DB.

## Верификация и воспроизведение

Логи/скрипты: `work/admin-pilot-20261023/` (scratch, не коммитятся).
Итоговая root регрессия:655 passed/0 failed/0 skipped; materialize×2
SHA256-idempotent (935 tracked files), check/VK startup parity exit0.
VK bundle сначала не собрался без обязательного PIVNIK_VK_API_BASE; повтор
с documented CI fixture https://vk-gateway.invalid exit0. Это проверка сборки,
не доступности gateway. Все7 generated files восстановлены byte-for-byte.
Desktop/mobile: cash+CRM12, paging12, invitations/proxy4 — **28 passed**.
Typecheck/build/lint/isolation-check exit0. Lint:12 прежних Fast Refresh warnings;
build: прежний chunk >500KiB warning. Root/Admin full+production audits —0.
Последний одновременный прогон Business дал470 passed/2 provisioning timeouts
(5000ms); не засчитан успешным. Полный повтор без конкурирующих
root/browser jobs прошёл **472/472, 40 files, 0 failed/0 skipped**, 70.12s;
прежний timeout сохранён, тесты для прохождения не ослаблялись.
Уже подтверждены базовые Node655/655, исходный Business433 с20 пропусками;
затем native471/471 и472/472 без пропусков. Последний native прогон после
финальных изменений/patch update:472/472 (`release-native-retry.log`).
Actual built runtime smoke Agent C:13 assertions PASS, local PG17; его временная
БД удалена, процессы остановлены. Это не Эвотор live E2E.

```bash
cd /workspace/pivnik-bonus-app
npm run materialize
# Снять SHA256 всех tracked files, выполнить materialize повторно и сравнить.
npm run materialize
node --test
npm run check
npm audit
npm audit --omit=dev --audit-level=high
npm run verify:vk-startup-parity
PIVNIK_VK_API_BASE=https://vk-gateway.invalid node scripts/build-vk-hosting.mjs
cd admin-platform
npm run typecheck
npm run build
npm run lint
node scripts/isolation-check.cjs
npm audit
npm audit --omit=dev --audit-level=high
# Для полного npm test необходимы собственные disposable native test DBs:
# SPACEVERSE_TEST_NATIVE_POSTGRES_URL (loopback/crm_fixture/codex_admin_test*)
# ADMIN_INTEGRATION_TEST_DATABASE_URL (только disposable codex_admin_test*).
npm test
npx playwright test -c playwright.evotor.config.ts
npx playwright test -c crm-pagination.config.ts
npx playwright test -c playwright.invitations.config.ts
```

Реальный production DB URL запрещён в этих тестах: integration suite содержит
DROP SCHEMA для собственной synthetic test DB. Локальная PG17 fixture создана
отдельно от существующих пользовательских сервисов и production.
Materialize меняет семь исторических generated files; их diff/хеши сохранены,
после проверок исходные байты восстанавливаются. Эти изменения не входят в PR.
Существующие root routes/денежные блокировки/patch-chain не редактировались.
Native test container `codex-admin-market-test-20261023` останавливается после
проверок; это созданная здесь synthetic PG17 fixture, не существующие сервисы.

## Действия владельца и Эвотора

1. Переподключить Railway App, чтобы read-only подтвердить deployment/source/root
   и presence необходимых настроек. Значения секретов не отправлять в чат.
2. Предоставить разрешённый **тестовый**, не production контур Эвотора: приложение,
   user/store/terminal, минимальные права, app callback authentication и стенд.
   Согласовать расхождение app-level vs user-level Authorization уведомлений.
3. Подтвердить издателя/договор/категорию CRM, единицу лицензии/комиссию,
   trial/grace/отмену/возвраты/AI опцию и юридические/поддержку реквизиты.
4. После полного тестового E2E/продуктовых gates отдельно разрешить merge,
   production deploy и подачу. Текущий мандат их исключает.

## Следующая инженерная работа после восстановления

Не начинать повторный аудит/переписывание продукта. Сначала проверить status,
актуальность origin/PR и прочитать этот файл. Затем закрывать следующий P0:
подтверждённое test install/account proof → связь с существующими canonical
company/venue → reconciled server license gates → активный независимый CRM path.
Только после этого выполнять end-to-end нового клиента и готовить подачу.
Дополнительные BI/marketing/AI функции остаются в существующем backlog.

Команда восстановления контекста:

```bash
cd /workspace/pivnik-bonus-app
git switch spaceverse/evotor-market-20261023
git status --short --branch
cat ops/ADMIN-PILOT-MARKET-PROGRESS.md
```

Продолжение задания: «Продолжи Admin Pilot по этой матрице; не выполняй
merge/deploy/production writes; не считай inbox лицензией; сначала восстанови
read-only Railway и разрешённый Evotor test flow, затем закрывай P0 binding/gates».

# Admin Pilot → Эвотор.Маркет: состояние и продолжение

Дата: 23 октября 2026. Ветка `spaceverse/evotor-market-20261023`.
База `origin/main`: `0dd84af1431db65ded266715c6cf4369c7a318cf`.
Код и тесты: commit `708b5724f3f035f09e080311dfa8bc9e01309a92`.
Draft PR: [#299](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/299).
**Статус продукта: не готов к коммерческому выпуску; публикация не выполнялась.**
Процент готовности не используется: ниже проверяемые функции и ограничения.

## AUTO-RESUME CHECKPOINT

Обновлено: 2026-10-25 21:13 UTC (AUTO-RESUME turn 9; turn 7 ниже как история).
Канонический координатор: automation `6add7969f55c8191a8e5eb93dbe96ff1`.
Единая кооперативная точка LOCK: `spaceverse/evotor-market-20261023` (#299).


### Последняя итерация — 2026-10-25 21:13 UTC, AUTO-RESUME turn 9

**Сделано (код, без production):**
- P0.1 #299: `admin-platform/server/tests/evotor-market-postgres.spec.ts` дополнен
  native PostgreSQL HTTP-тестом отката неудачной ротации токена через реальный
  CHECK violation и безопасного конкурентного retry. Commit
  `7d5a0a4eb82bce95af8fc11714af8a636ad9648d`. Новая версия теста
  **НЕ прошла CI**: для этого SHA workflow runs отсутствуют; не считать PASS.
- P0.2 #302: исправлена проверка пустых частей подписанного owner proof
  `9d8d9fff61abd245cb56baa31c5a0fd0a061d823`; добавлена ручная
  миграция 020 `2d6078a119d200c52d3adb72db797776802415fd`,
  не подключённый к маршрутам native SQL nonce consumer
  `9c26c70e565a13eb33615fd6f859b7b9757b126e`, четыре native PostgreSQL
  теста `d75e8b1f2643cca2e5bdbde4fc1db01983eccb77`,
  выделенный CI `09c18570523220029481c2048b44b79293a8d1dc`
  и обновлённый MODULE-MAP `d99b72f6d6f7d594df342f546de09e3dced56923`.
  Миграция НЕ применялась, API/tenant/лицензия НЕ активированы.
- GitHub `main` на проверке: `517ea17c4620b843c08b4d01f781c666b41f3548`.
  #299, #296, #302, #96 открыты Draft. #299 и #296 конфликтуют с main;
  #302 mergeable относительно базы #299, но не готов к merge.

**CI evidence:** на #302 HEAD `d99b72f` native owner nonce workflow
`40234384143` **SUCCESS**; предыдущий полный кодовый SHA `09c1857`
workflow `40234337831` **SUCCESS**. Логи job `121292568958`:
`npm test --prefix admin-platform -- server/tests/evotor-market-owner-nonce-postgres.spec.ts`
**4 pass/0 fail/0 skip**, и
`npm test --prefix admin-platform -- server/tests/evotor-market-owner-proof.spec.ts`
**26 pass/0 fail/0 skip**. Это реальные GitHub Actions PostgreSQL 16
(disposable), не локальные тесты этой automation. На момент checkpoint
#302 release gate `40234384155` и browser `40234384197`
ещё in_progress; их успех не заявлен. Старый #302 browser gate
`40214993675` failure (fixture webServer exit 2) не считать закрытым.
#299 native test после commit `7d5a0a4` CI не запускался.

**Release-gate матрица:**

| Функция | Реализовано | Проверено | main | production | Блокер / следующее действие |
| --- | --- | --- | --- | --- | --- |
| P0.1 callback inbox | Draft #299 | прежний native PASS; новый rollback test без CI | нет | не подтверждено | Разобрать конфликт #299 с main, запустить native CI на новом SHA |
| P0.2 owner nonce | Draft #302, unmounted | native PG 4 PASS + proof 26 PASS | нет | нет | Trusted provider owner issuer, atomic binding, revocation/token revision |
| P0.3 CRM bootstrap | Draft #296 | предыдущий CI PASS; текущая native интеграция не проверена | нет | не подтверждено | Разрешить конфликт с main и negative tenant E2E |
| P0.4 server license | Нет подтверждённого готового authorizer | нет | нет | нет | Verified provider grants + reconciliation + tariff contract |
| P0.5 fiscal sync | Частичный существующий контур | новый tenant E2E нет | не подтверждено | не подтверждено | Тестовый Evotor store/terminal и закрытые документы |
| Onboarding/market | Частичный Draft | end-to-end A–H не пройден | нет | нет | Provider account, юридические условия, release gates |

**Не проверено лично:** нет локального клона (github.com DNS недоступен),
поэтому `npm run materialize` ×2, `node --test`, `npm run check`,
full audits, native PG локально, browser/mobile и реальные касса/production
не выполнялись. `pivnik-preflight` не обнаружен среди доступных skills.
`automations.peek` в этом runtime недоступен; single-flight использовал
CAS по GitHub blob SHA и повторную проверку собственного LOCK, не претендуя
на глобальную блокировку всех writers.

**Риски:** P0: нет доказанного provider owner proof и server license,
продукт нельзя продавать/активировать. P1: #299 не запускает CI нового
native теста и конфликтует с main; #302 browser gate пока не закрыт.
P2: nonce consumer unmounted и не связан с атомарным canonical grant check.

**Точное следующее действие:** проверить завершившийся CI #302 и
причину browser fixture exit 2; затем на свежем main безопасно разрешить
конфликт #299 без затрагивания кассы/денег и запустить новый native callback
rollback test. После этого P0.2 trusted provider identity → binding-time
grant/token revision validation. Ни merge, ни deploy, ни миграции в production.

**Checkpoint commit:** текущий коммит этой записи, SHA получить из GitHub
после CAS; самоссылочный SHA не записывать. Последний implementation commit
#302 `d99b72f6d6f7d594df342f546de09e3dced56923`, #299 `7d5a0a4eb82bce95af8fc11714af8a636ad9648d`.
**LOCK:** `auto9-20261025T205815Z-krm9` освобождён после остановки
собственных writers. Продолжение в следующем запуске, без новой automation.


- Последний инженерный slice: **P0.2, fail-closed one-time internal
  owner-binding claim verifier** в Draft #302, без API-маршрута и без
  активации бизнеса. Новый `admin-platform/server/evotor-market-owner-proof.ts`
  проверяет HMAC-SHA256, exact session/provider/product/company/store/revision
  scope, срок до 5 минут, формат nonce и требует атомарный durable
  consumeNonce callback. Повтор, подмена владельца/сессии/магазина,
  неверная подпись, истечение, некорректный BIGINT и ошибка nonce-store
  отклоняются. Важно: **подпись SPACEVERSE не является подтверждением
  владения магазином Эвотора**; доверенный provider proof issuer, native
  PostgreSQL nonce consumer и binding transaction ещё НЕ реализованы.
- Реализация в #302: `5ef3cb33360be42cce3ce45ee3b69331cc36a05b`
  (verifier), `65f1049f900b522fb394127dc94da66312acb533`
  (26 negative/positive Vitest tests), итоговый implementation/docs HEAD
  **`ea5630a9fb93e01e5adefc8c01d429ee4f6cf2da`** (MODULE-MAP).
  Существующий revision guard #302 `9ede48d4`, P0.1 #299 и CRM #296
  не изменены в этом slice.
- Checkpoint commit: **текущий коммит этой записи**, точный SHA читать из
  GitHub после CAS; самоссылочный SHA не записывать.
- Лично выполнено: Node 22 `--experimental-strip-types` synthetic smoke
  нового verifier: **1 positive + 17 negative PASS**. Локальный full
  checkout недоступен (github.com DNS в контейнере).
- GitHub Actions на #302 HEAD: release gate `40214993745`
  **completed/success**, root Node **656 pass/0 fail/0 skip**,
  Admin Vitest **541 pass/0 fail/24 skip**, в том числе новый
  `evotor-market-owner-proof.spec.ts` **26 pass**. Root check,
  materialize/regression и npm audits в release gate завершились успешно.
  24 пропущенных native/integration теста **не являются PASS**.
  Browser `40214993675` **failure** на первой и повторной попытке:
  cash dashboard desktop/mobile **12 pass**, но `npm run
  test:e2e:onboarding` не запустил fixture webServer, exit code 2.
  Причина пока не доказана, тестовый gate остаётся красным; не merge.
- Не проверено: реальный provider account owner proof, установка и token
  rotation Эвотора, native PostgreSQL nonce consumption и atomic binding,
  Admin typecheck отдельно, live E2E, production, реальная касса.
  `pivnik-preflight` отсутствует среди доступных skills.
- Незакрытый P0.2: server-verified provider identity и одноразовая
  выдача proof только после неё, durable native SQL nonce storage,
  актуальные canonical grants + token revision в одной binding
  транзакции. Существующий verifier **не** выдаёт лицензию.
- Отдельный CI-блокер: два воспроизводимых browser onboarding fixture
  startup exit 2. Исследовать точную причину отдельным минимальным
  исправлением, не расширяя текущий proof scope.
- Внешние blockers: разрешённый тестовый аккаунт/магазин/приложение
  Эвотора и контракт owner authentication; disposable native DB для
  проверки реальной транзакции. Production/merge/deploy/платные
  ресурсы/подача в Маркет не разрешены.
- Следующее точное действие: подготовить отдельный native PostgreSQL
  одноразовый nonce consumer с атомарным INSERT ON CONFLICT и
  конкурентным/replay тестом, затем проверить provider issuer.
- LOCK `auto7-20261025T1704Z-iyemnwfs` освобождён после завершения
  всех собственных writers и CI review. Это кооперативная CAS-блокировка,
  а не гарантия против сторонних writers.

### LOCK — общий протокол единственного исполнителя

```json
{"owner_run_id":null,"acquired_at":null,"status":"released"}
```

Перед записью проверь run_details обеих инженерных automations через peek.
Указанный выше последний run завершён; второй CRM-run
`41d8fe36-1bc8-8325-be7a-43450980a7ea` также completed.
Каждый следующий writer сначала читает ЭТОТ файл и его blob SHA, затем атомарно
меняет released LOCK на active со своим уникальным owner_run_id/acquired_at
через update_file(sha=прочитанный blob). При 409/конфликте — перечитать и уступить,
не перезаписывать. Затем повторно прочитать и подтвердить своё владение.
Общий LOCK обязателен для #296/#302; дочерние копии progress не являются locks.
Перед каждым push/remote write сверять владельца; не перетирать этот журнал
старым локальным progress. Публикация кода — только fast-forward, без force.
Освобождать только свой LOCK с новым SHA после остановки собственных writers.
Чужой active LOCK не снимать по возрасту: требуется доказанное завершение
владельца; при неопределённости пропустить конкурирующую запись.
Это кооперативная CAS-блокировка, не гарантия против writers вне протокола.

При временной недоступности инструмента ограничить повторы и отложить конфликтную
запись до следующего запуска. Не отключать расписание из-за временного блокера:
остальные разрешённые задачи выполнять, если для них выполнен протокол.
Отсутствие checkpoint при released/отсутствующем LOCK само по себе не блокер:
его можно инициализировать CAS-записью, как в этом коммите.

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

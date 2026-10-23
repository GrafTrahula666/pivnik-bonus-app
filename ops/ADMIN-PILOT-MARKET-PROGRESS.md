# Admin Pilot → Эвотор.Маркет: состояние и продолжение

Дата: 23 октября 2026. Ветка `spaceverse/evotor-market-20261023`.
База `origin/main`: `0dd84af1431db65ded266715c6cf4369c7a318cf`.
**Статус продукта: не готов к коммерческому выпуску; публикация не выполнялась.**
Процент готовности не используется: ниже проверяемые функции и ограничения.

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

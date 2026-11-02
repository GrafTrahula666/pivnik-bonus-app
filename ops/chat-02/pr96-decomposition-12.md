# CHAT 02 / пункт 12 — decomposition of conflicting Draft PR #96

**Дата:** 2026-11-01  
**Режим:** отдельная Draft-ветка, без merge/deploy/production writes.  
**База:** `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`  
**Источник:** [Draft PR #96](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/96), head `febefa93f6a53c3b47db3a1fe2ec3ed727baaac8`; актуальность повторно проверять.

## Что установлено по API GitHub

Compare `main...PR#96`: **diverged**, 194 commits ahead, 371 behind, merge base `1f5d0fd86663a4c65135616925cf09a91e682f04`; **141 paths** changed (132 added, 9 modified). `mergeable=false`, `draft=true`. **Не делать squash/rebase/merge всей ветки в main.**

Группы файлов (взаимоисключающее разбиение списка GitHub `compare_commits`):
- **2** `authorization-*.js` — узкая модель совместимости старых ролей и scope, без server route wiring.
- **6** `transaction-*.js` — scoped read/replay/quota/rolling spend и запись compatibility; требуют проверки связности с текущими миграциями и POS.
- **28** `customer-*.js/css` — Customer 360, метаданные, ручные бонусы и достижения; не самостоятельный пакет.
- **25** `dashboard-*.js/css` — scope directory, controls, UI, API; в `main` уже существует отдельная актуальная Admin Platform, нельзя просто включить старый composite gateway.
- **2** manual SQL `migrations/010_spaceverse_customer_metadata.sql` и `011_spaceverse_scope_directory.sql` — не wired в startup. В текущем `main` имена `010_repair_originaltopg_admin.sql` и `011_halloween_raffle.sql` уже используют эти номера в другом контуре; не переименовывать/применять SQL без отдельного review контрактов, migration history и canonical data model.
- **3** root entrypoints `package.json`, `server.js`, `universal-server.js` — возможные широкие регрессии. Не переносить в этом срезе. Дублированные маршруты должны сохранять паритет.
- **67** `test/*` — в основном проверяют новые модули PR #96 и не являются независимыми переносимыми изменениями.
- **8** other modules (`admin-adjustment-*`, `legacy-api-boundary.js`, `scope-directory-repository.js`, `spaceverse-runtime.js`, `spaceverse-server-composition.js`) — gateway/денежная/директория; требуют отдельной постановки и негативных тестов.

## Выделенный безопасный независимый фрагмент

Этот PR переносит из #96 **ровно 4 существующих файла** (байтовое равенство Git blob с #96 подтверждено на каждом):
1. `authorization-membership.js`: если membership существует или явно запрошен tenant/location, отсутствие совпадающего права возвращает `mode:'scoped'`, а не `legacy`.
2. `authorization-middleware.js`: tenant-wide доступ только через `canManageTenant`; scoped `adminWrite` требует management; legacy fallback остаётся **только** при `scopeMode:'none'`, отсутствии явно запрошенного scope и `mode:'legacy'`. Запрещён OR со старыми ролями на scoped route.
3. `test/authorization-membership.test.js`: фиксация fail-closed при чужом tenant/location и явном scope.
4. `test/authorization-middleware.test.js`: негативные случаи чужой компании для admin/viewer/staff, staff tenant-admin write escalation, восстановление глобальных прав после membership downgrade/подмены scope.

**Контракт:** `authorization-context.js` не меняется; эти helpers в проверенном default-branch code search используются в своих `test/authorization-*.test.js`, а не в действующих entrypoints. Поэтому PR **не заявляет устранение всех production RBAC-рисков** и не включает никаких новых HTTP routes. Изменений данных, миграций, глобальных env, patch-chain, устройств и Railway нет. Старые unscoped legacy users продолжают проходить при соответствующей legacy capability и отсутствии membership/scope.

## Gate перед интеграцией

1. `node --test test/authorization-membership.test.js test/authorization-middleware.test.js`.
2. `npm run materialize` дважды, проверить byte-for-byte idempotence; `node --test`, `npm run check`, `npm audit`.
3. Проверить, что в gateway/реальных маршрутах не добавлен silent consumer изменённых helpers, а существующие legacy permissions без tenant scope сохранены.
4. После ребейза на свежий main повторить все проверки, negative access tests на отдельной PostgreSQL и подписанные HTTP маршруты, прежде чем применять изменения в действующий контур.
5. Внести PR только через ревью координатора CHAT 01. Не деплоить Draft, не включать scoped mode без canonical owner/membership truth.

**В этой сессии:** исходный `main`, `Do not break`, `#96`, origin-ветки и consumer references проверены через GitHub; скопированы 4 security files и создан этот checkpoint. **Локальный checkout недоступен (GitHub DNS отсутствует в container); npm/node tests, PostgreSQL, HTTP и live-Evotor не запускались.** CI-статус Draft проверить после создания PR.

**Следующая задача:** CHAT 02 №13 — отрицательный тест чтения CRM при подмене чужого company/venue/customer ID с real HTTP + disposable PostgreSQL; сначала проверить актуальные merged PR и существующие тесты `admin-platform/server/tests/tenant-crm-http.spec.ts`. Шаг №12 считать интеграционно готовым только после проверки CI и принятия координатором; до этого следующий час повторно оценить тот же PR, а не безусловно переходить на №13.

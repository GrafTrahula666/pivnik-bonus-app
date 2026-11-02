# CHAT 03 · пункт 24 — создание ручного контакта CRM

**Дата:** 2026-11-01.
**База:** `origin/main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
**Режим:** собственная изолированная ветка, Draft PR, без merge/deploy и реальных данных.

## Почему не используется уже готовый customer-provisioning.js

Этот существующий repository создаёт `users`, `user_identities`,
`wallets` и `spaceverse_customer_ownership` для **подтверждённого
Telegram/VK account**. Ручной ввод телефона/почты владельцем не подтверждает
принадлежность человеку его Telegram/VK/кассовой identity. Автоматическое
использование provisioning было бы небезопасным связыванием.

## Реализованный узкий срез (ещё НЕ рабочая кнопка)

- Ручная `002_manual_crm_contacts.sql`: отдельные таблицы contact/creation ledger,
  строгая подготовленная tenant binding, отдельный unique email/phone per
  venue, явный migration guard, никакого backfill или автоматического startup.
- `crm-manual-contact-create.js`: unmounted pure write service. Серверный
  runtime/company/venue; `BEGIN` + `FOR SHARE` binding +
  atomic request ledger + contact + `COMMIT`. Вход: имя, фамилия, E.164 phone
  и/или email; UUIDv4 request key. Валидация и canonical normalization до
  SQL, повторный request возвращает исходный contact, конфликт payload/duplicate
  не создаёт лишнюю строку.
- **Identity unlinked**: не создаёт `users`, `user_identities`, `wallets`,
  бонусы или покупки. Существующие API клиентов ПИВНИКА не меняются.
- `test/spaceverse-manual-crm-contact.test.js`: synthetic PGlite для
  migration guard/idempotence, duplicate phone/email, replay, foreign scope,
  invalid input/no SQL и двух изолированных tenant.

## Статус

**IN PROGRESS (foundation VERIFIED):** кодовый head до checkpoint `69898b6761408f9628840d0c0ef4d03d3315acfa`. 
[Pivnik release gate #41271982966](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41271982966) **SUCCESS**: double materialize/idempotence, JS check, root Node **611 passed / 0 failed** (включая 5 новых PGlite-кейсов), Business Vitest **645 passed / 90 skipped**, high-threshold dependency audits exit 0. Остались 12 moderate advisories в зависимостях, отдельная задача. [Native PostgreSQL workflow](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41271982931) и [Business browser workflow](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41271983035) **SUCCESS**, но не являются native PostgreSQL CRUD acceptance именно для новых ручных контактов. Предыдущие CI ошибки в новой SQL-миграции (прерванное поле телефона, повторный SQL после COMMIT) и отсутствующая проверка нового .js в `npm run check` исправлены и проверены. Версия до фикса не проходила и не выпускалась.

**Это пока только unmounted foundation, не завершённый пункт 24.** Нет endpoint
или UI, нет возможности владельцу создавать контакты в production.
До подключения обязательны existing Admin session/grants, Origin/CSRF,
audit; только после отдельного согласования lifecycle и explicit schema
provisioning. Это частичный срез пункта 24, не завершение.

## Следующее безопасное действие

Проверить новый PR exact-head CI, исправить только относящиеся к пункту
ошибки; после этого отдельным изолированным шагом добавить
default-off Admin create endpoint с revalidation grant + audit и
подтверждением отсутствия `legacy PIVNIK` writes.


## Checkpoint продолжения — 2026-11-01, задача 24 остаётся IN PROGRESS

- Повторно проверены `origin/main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`, CRM origin-ветки, открытые Draft PR и актуальный `ops/MODULE-MAP.md` с Do not break. Пункты 21–22 уже в main, пункт 23 изолирован в Draft #359 (кодовый HEAD `f7e5e5de95937b1cb18692943539584c1bcaf630`); не дублировались. Собственный Draft #371 остаётся единственным PR пункта 24. Координатор CHAT 01 ведёт отдельный Draft #358. Чужие файлы и ветки не изменены.
- Новый узкий тестовый срез на кодовом HEAD `df1b68e54e3bc2edf7c6f93fa67c8adb3f4810c6`: три failure-injection сценария в `test/spaceverse-manual-crm-contact.test.js`. Проверяют откат одновременно контакта и idempotency ledger при ошибке завершения, повтор после потерянного подтверждения `COMMIT` без второго клиента, и запрет записи при подключении проверенного runtime к чужой tenant DB. Эти сценарии не являются production/native-PG E2E.
- Предыдущий точный HEAD `0d5764e56766879eb2e89b8fdbca4e1cc1b59a11` имел три зелёных GitHub workflow: [release gate](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41272264054), [native PostgreSQL (смежный модуль)](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41272264077), [Business browser](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41272264065). Для нового кода на `df1b68e5` запущены [release gate #41273794152](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41273794152), [native PG #41273794177](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41273794177) и [Business browser #41273794147](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41273794147); результаты нужно проверить до статуса VERIFIED. Локального checkout/npm здесь нет; `git ls-remote` не смог разрешить github.com, поэтому локальные materialize×2/node --test/npm run check/npm audit не запускались.
- Railway read-only: доступный `pivnik-admin-staging`, environment `production`, содержит два Admin сервиса на ветке `admin-platform/staging-qa` с последними SUCCESS deployment от 2026-08-31; текущая CRM Draft-ветка туда не деплоилась. Изменений Railway, переменных, данных и секретов нет.
- Сравнение PR #371 с main: только manual CRM migration/service/test/docs и `package.json` (добавлена синтаксическая проверка сервиса). `server.js` и `universal-server.js` не менялись, следовательно их дублированные legacy auth/staff/admin/leaderboard routes не затронуты. `requireLegacyBar` не ослаблялся.
- **Блокеры до завершения пункта 24:** отдельный default-off Admin POST с актуальными owner/grant/session, Origin/CSRF, rate limit, запретом request-derived scope и обязательным audit; атомарное или доказуемо восстановимое сопоставление target write с audit при двух БД; явное одобрение ручной миграции 002 и lifecycle. Текущая основа остаётся UNMOUNTED. Никаких реальных контактов, бонусов, wallets, identities, merge/deploy или live E2E.

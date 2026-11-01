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

**IN PROGRESS:** исходники записаны в GitHub, ещё не проверены
root `node --test`, CI, native PostgreSQL и security review. Нет endpoint
или UI, нет возможности владельцу создавать контакты в production.
До подключения обязательны existing Admin session/grants, Origin/CSRF,
audit; только после отдельного согласования lifecycle и explicit schema
provisioning. Это частичный срез пункта 24, не завершение.

## Следующее безопасное действие

Проверить новый PR exact-head CI, исправить только относящиеся к пункту
ошибки; после этого отдельным изолированным шагом добавить
default-off Admin create endpoint с revalidation grant + audit и
подтверждением отсутствия `legacy PIVNIK` writes.

# Production runbook — «Пивник» VK + Telegram

## 1. Обязательные Railway variables

Оба сервиса должны использовать один и тот же `DATABASE_URL`, `SESSION_SECRET`, `IDENTITY_TOMBSTONE_SECRET` и одинаковые юридические значения:

- `NODE_ENV=production`
- `ALLOW_DEMO=false`
- `DATABASE_URL`
- `SESSION_SECRET` — минимум 32 символа
- `IDENTITY_TOMBSTONE_SECRET` — отдельный стабильный секрет, минимум 32 символа
- `LEGAL_OPERATOR_NAME`
- `LEGAL_OPERATOR_ID`
- `LEGAL_CONTACT_EMAIL`
- `LEGAL_OPERATOR_ADDRESS`
- `LEGAL_DATA_RETENTION_POLICY`

Telegram-сервис дополнительно получает `TELEGRAM_BOT_TOKEN` и Telegram owner IDs. VK-сервис получает `VK_APP_ID`, `VK_APP_SECRET` и `OWNER_VK_ID`.

`IDENTITY_TOMBSTONE_SECRET` нельзя менять вместе с обычной ротацией `SESSION_SECRET`. Его потеря снимет защиту от повторных стартовых наград для ранее удалённых аккаунтов.

## 2. Backup перед релизом

```bash
DATABASE_URL='postgresql://...' \
BACKUP_DIR='./backups' \
bash ops/backup-postgres.sh
```

Сохранить `.dump` и `.dump.sha256` вне Railway. Проверка архива выполняется автоматически через `pg_restore --list`.

## 3. Проверка базы до переключения

```bash
DATABASE_URL='postgresql://...' npm run verify:database
```

Команда должна вернуть `"ok": true`. Она проверяет:

- отсутствие дублирующихся VK/Telegram identity;
- совпадение wallet с журналом операций;
- отсутствие identity у архивированных объединённых профилей;
- наличие migration `005_runtime_identity.sql`;
- fingerprint логической базы.

## 4. Деплой

1. Развернуть один и тот же commit на VK и Telegram Railway-сервисах.
2. Дождаться успешного `/api/health` у обоих сервисов.
3. Выполнить автоматическую сверку:

```bash
TELEGRAM_APP_URL='https://telegram-service.example' \
VK_APP_URL='https://vk-service.example' \
npm run verify:production
```

Релиз запрещён, если fingerprint базы, commit или версия правил отличаются.

## 5. E2E после деплоя

1. Войти новым пользователем в Telegram.
2. Принять правила и проверить однократные стартовые награды.
3. Начислить и списать бонусы через QR.
4. Привязать VK к Telegram.
5. Сверить баланс, историю, статус, достижения, подарочное пиво и рейтинг.
6. Выполнить операцию через VK и проверить её в Telegram.
7. Повторить в обратном направлении.
8. Проверить двойное нажатие, обрыв сети и два устройства одновременно.
9. Удалить тестовый аккаунт, войти снова и убедиться, что стартовые награды повторно не выданы.

## 6. Rollback кода

1. Не откатывать базу автоматически при обычном дефекте интерфейса.
2. Вернуть оба Railway-сервиса на один и тот же предыдущий commit.
3. Повторить `npm run verify:production`.
4. Проверить `/api/health`, авторизацию и одну тестовую операцию.

## 7. Restore базы

Восстановление выполнять только в отдельную пустую/тестовую базу, проверить её и лишь затем переключать сервисы.

```bash
RESTORE_DATABASE_URL='postgresql://target...' \
BACKUP_FILE='./backups/pivnik-YYYYMMDDTHHMMSSZ.dump' \
CONFIRM_RESTORE='RESTORE_PIVNIK' \
bash ops/restore-postgres.sh
```

После восстановления выполнить:

```bash
DATABASE_URL='postgresql://target...' npm run verify:database
```

Затем переключить оба сервиса одновременно и проверить общий fingerprint.

## 8. Запрет релиза

Не выпускать приложение и не запускать рекламу при любом из условий:

- `verify:database` или `verify:production` возвращает ошибку;
- VK и Telegram имеют разные fingerprint или commit;
- юридические значения не заполнены;
- отсутствует проверенный backup;
- не выполнен E2E на реальных VK и Telegram аккаунтах;
- есть BLOCKER или CRITICAL дефект.

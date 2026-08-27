# Production runbook — «Пивник» VK + Telegram

## 1. Текущая production-схема

Подтверждённые публичные сервисы:

- Telegram: `https://pivnik-bonus-app-production-df60.up.railway.app`
- VK Railway origin: `https://pivnik-vk-test-production-3474.up.railway.app`
- VK Mini App document: `https://pivnik-vk-test-production-3474.up.railway.app/vk`

Активная Railway production-конфигурация:

- project: `20a942f9-3164-484a-a6f1-565439e38705`
- environment: `cdd9d26c-2aab-45d9-95ed-ef487fafaa8f`
- Telegram service: `d8d26f64-9ac1-4a03-9036-1a60f43c0be6`
- VK service: `0573c420-0f9c-43bd-8e87-e1788ce3eefd`
- Postgres service: `4f0c39c3-cd84-4f41-a97e-c95b342653c4`

Старые адреса без суффиксов `-df60` / `-3474` не являются production-адресами и не должны использоваться в VK, GitHub Actions, Railway variables или проверочных скриптах.

Vercel `pivnik-vk-proxy.vercel.app` не является текущей точкой запуска VK Mini App. VK должен открывать Railway document `/vk` напрямую.

## 2. Доступ Railway для автоматизации

Railway account/project token хранится только как GitHub Actions repository secret:

- `RAILWAY_TOKEN`
- `RAILWAY_API_TOKEN`

Токены не публиковать в issue, PR, коде или логах.

## 3. Обязательные Railway variables

Оба production-сервиса должны использовать один и тот же `DATABASE_URL`, `SESSION_SECRET`, `IDENTITY_TOMBSTONE_SECRET` и одинаковые юридические значения:

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

Telegram:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_APP_URL=https://pivnik-bonus-app-production-df60.up.railway.app`
- `PIVNIK_APP_URL=https://pivnik-bonus-app-production-df60.up.railway.app`

VK:

- `VK_APP_ID=54694987`
- `VK_APP_SECRET`
- `VK_APP_URL=https://pivnik-vk-test-production-3474.up.railway.app`

`IDENTITY_TOMBSTONE_SECRET` нельзя менять вместе с обычной ротацией `SESSION_SECRET`. Его потеря снимет защиту от повторных стартовых наград для ранее удалённых аккаунтов.

## 4. Backup перед релизом

Для production-базы выполнить backup:

```bash
DATABASE_URL='postgresql://...' \
BACKUP_DIR='./backups' \
bash ops/backup-postgres.sh
```

Сохранить `.dump` и `.dump.sha256` вне Railway. Проверка архива выполняется через `pg_restore --list`.

## 5. Проверка базы

```bash
DATABASE_URL='postgresql://...' npm run verify:database
```

Команда должна вернуть `"ok": true`.

## 6. Деплой

Один и тот же commit должен работать на Telegram и VK Railway-сервисах. Release gate сам получает актуальные публичные домены из Railway API, поэтому старые hostname нельзя хардкодить в workflow.

После деплоя обязательны:

```bash
npm run probe:production
npm run verify:production
npm run verify:platform-separation
```

Production release gate дополнительно выполняет подписанный auth smoke для Telegram и VK через реальные production credentials и проверяет повторную авторизацию, профиль, QR и достижения.

Релиз считается невалидным, если отличаются database fingerprint, commit, версия правил или один из production endpoint не готов.

## 7. VK Mini App

VK App ID: `54694987`.

Во всех URL-полях платформы VK должен быть сохранён:

`https://pivnik-vk-test-production-3474.up.railway.app/vk`

При реальном запуске VK добавляет подписанные `vk_*` параметры и `sign`. Если Request URL указывает на `https://pivnik-vk-test-production.up.railway.app/...` без `-3474`, VK использует устаревшую настройку — такой запуск не достигает текущего Railway-сервиса.

Смена Railway hostname не требует новых `VK_APP_ID` или `VK_APP_SECRET`, пока используется тот же VK App ID `54694987`.

## 8. E2E после деплоя

1. Открыть Telegram Mini App и проверить авторизацию, профиль, QR, баланс и достижения.
2. Открыть `https://vk.ru/app54694987` и проверить, что Request URL ведёт на hostname с `-3474`.
3. Проверить авторизацию VK, профиль, QR, баланс и достижения.
4. Проверить одну безопасную тестовую операцию и повторный вход.
5. Проверить, что Telegram и VK используют одну production-базу, но отдельные платформенные identity согласно текущей модели аккаунтов.

## 9. Rollback кода

1. Не откатывать базу автоматически при дефекте интерфейса.
2. Возвращать оба Railway-сервиса на один и тот же предыдущий commit.
3. Не восстанавливать старые Railway project/service IDs и старые hostname вместе с rollback исходников.
4. Повторить `npm run probe:production`, `npm run verify:production` и auth smoke.

Критически важно: rollback source tree не должен откатывать инфраструктурную маршрутизацию. Текущие Railway IDs и домены задаются в `scripts/railway-production-config.mjs` и защищены regression-тестами.

## 10. Restore базы

Восстановление выполнять только в отдельную пустую/тестовую базу, проверить её и лишь затем переключать сервисы.

```bash
RESTORE_DATABASE_URL='postgresql://target...' \
BACKUP_FILE='./backups/pivnik-YYYYMMDDTHHMMSSZ.dump' \
CONFIRM_RESTORE='RESTORE_PIVNIK' \
bash ops/restore-postgres.sh
```

После восстановления:

```bash
DATABASE_URL='postgresql://target...' npm run verify:database
```

## 11. Запрет релиза

Не выпускать приложение при любом из условий:

- `verify:database`, `probe:production`, `verify:production` или signed auth smoke возвращает ошибку;
- VK и Telegram имеют разные fingerprint или commit;
- VK runtime Request URL указывает на старый hostname без `-3474`;
- юридические значения не заполнены;
- отсутствует проверенный backup;
- есть BLOCKER или CRITICAL дефект.

# Пивник — Telegram/VK Mini App лояльности бара

Node.js >=20, ESM (`"type": "module"`), Express 4 + PostgreSQL (`pg`), фронтенд без фреймворка (`app.js`, `index.html`, `styles.css`). Деплой: Railway. Платформы: Telegram и VK; роли: клиент, бармен, партнёр-наблюдатель, владелец.

## Команды
- `npm test` — `node --test` (~420+ тестов, нужен `npm run materialize` перед запуском, см. ниже)
- `npm run check` — `node --check` по всем скриптам и серверным файлам
- `npm run materialize` — применяет цепочку патчей `scripts/apply-*.mjs` к исходникам (только локально, без БД)
- `npm start` — `prestart` (патчи + `red-cosmos-v2-db-prepare`, нужен `DATABASE_URL`) → `universal-server.js`
- `npm run audit:runtime-patches` / `audit:runtime-inventory` / `audit:runtime-retirement` — аудит цепочки патчей

## Важно: патч-цепочка
Исходники в git — «базовые»; рабочее состояние получается после `materialize`/`prestart`, которые переписывают `app.js`, `server.js`, `universal-server.js`, `index.html`, `achievements.js`, `red-cosmos-v2.*`. Многие тесты проверяют именно запатченное состояние: на чистом клоне без `materialize` они падают. После прогона тестов откатывай изменения (`git checkout -- .`), если не собираешься коммитить результат патчей.
Не добавляй новые `apply-*.mjs` — часть уже выводится из обращения (`Retire apply-...`); правь исходник напрямую и обнови тесты.

## Правила
- Клонировать с `core.autocrlf=false`: тесты сверяют строки и хэши, CRLF их ломает.
- Применённые миграции (`migrations/001..010`) не переписывать — только новые файлы (см. тест `working updates never rewrite applied migration 007`).
- Бонусная логика (начисление, списание, отмены, корректировки) — только через `*-persistence.js` и `authorization-*.js`; любые правки сопровождать тестами и `/security-review`.
- Секреты только через env (`DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `OWNER_TELEGRAM_ID`, `SESSION_SECRET`); `.env*` не читать и не коммитить.
- Production-скрипты `scripts/railway-*.mjs` меняют боевую инфраструктуру — не запускать без явной просьбы.

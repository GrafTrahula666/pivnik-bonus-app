# VK Native Hosting migration runbook

Цель: убрать зависимость браузера пользователя VK от прямой доступности Railway/Vercel из России.

## Целевая схема

`VK -> VK Mini Apps Hosting -> Russian HTTPS API Gateway -> Railway VK backend -> existing PostgreSQL`

На этом этапе Railway backend и production PostgreSQL не переносятся.

## 1. Поднять gateway параллельно production

Разместить `vk-api-gateway/` на VPS/облаке с хорошей доступностью из РФ. Нужен отдельный HTTPS-домен, например `api.<domain>`.

В `.env`:

- `GATEWAY_DOMAIN` — публичный домен gateway;
- `RAILWAY_ORIGIN=https://pivnik-vk-test-production-3474.up.railway.app`.

Запуск:

```bash
cd vk-api-gateway
cp .env.example .env
docker compose up -d --build
```

Проверки:

```bash
curl https://GATEWAY_DOMAIN/healthz
curl https://GATEWAY_DOMAIN/readyz
```

`readyz` должен вернуть `ok:true`, `upstream.vk:true`, `environment:production`.

Критически важно проверить оба URL с российского мобильного интернета без VPN до переключения VK.

## 2. Собрать VK static bundle

```bash
PIVNIK_VK_API_BASE=https://GATEWAY_DOMAIN npm run build:vk-hosting
```

Сборка должна завершиться с `ok:true`. Она специально запрещает Railway/Vercel в качестве browser API base.

## 3. Сначала VK Hosting dev

В GitHub добавить repository secret:

`VK_MINI_APPS_ACCESS_TOKEN`

Используется официальный `@vkontakte/vk-miniapps-deploy@1.0.2`. Согласно документации VK, CI принимает `MINI_APPS_ACCESS_TOKEN`; `MINI_APPS_ENVIRONMENT=dev` обновляет dev URL.

Запустить вручную workflow `VK native hosting deploy`:

- `api_base` = URL gateway;
- `environment` = `dev`;
- `confirm` пустой.

## 4. E2E без VPN

На dev URL VK Hosting проверить:

1. запуск приложения;
2. VK auth;
3. профиль и аватар;
4. баланс и история;
5. QR;
6. согласие;
7. служебные кнопки admin/staff для пользователя с ролью;
8. GET и POST операции через gateway;
9. повторный вход;
10. одинаковое поведение Wi-Fi и мобильного интернета без VPN.

Параллельно проверить `gateway/readyz` и Railway `/api/platform-health`: fingerprint БД и release commit должны соответствовать текущему production backend.

## 5. Production switch

Только после успешного dev E2E повторно запустить workflow:

- `environment` = `production`;
- `confirm` = `DEPLOY_VK_PRODUCTION`.

VK deploy tool сам обновляет production URL на URL нативного Hosting. Прямой Railway/Vercel URL в настройках запуска больше не использовать.

## 6. Rollback

Если native Hosting/gateway даёт дефект приложения, вернуть VK launch URL на предыдущую известную рабочую точку. Базу данных не откатывать. Railway backend не менять.

Gateway можно остановить независимо — он не хранит пользовательские данные и не является источником истины.

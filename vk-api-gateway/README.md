# VK API Gateway

Отдельный публичный API-шлюз для VK Mini App. Он предназначен для размещения на VPS/облаке, которое стабильно доступно пользователям из России.

Схема:

`VK Hosting -> HTTPS gateway -> Railway VK backend -> PostgreSQL`

Production PostgreSQL и Railway backend при этом не переносятся и не меняются.

## Что делает шлюз

- наружу публикует только `/api/*`, `/healthz` и `/readyz`;
- принимает browser CORS с нативного VK Hosting (`*.pages.vk-apps.com`, `*.pages.vk-apps.ru`);
- сохраняет Bearer-токены, служебные заголовки и тело запроса;
- не проксирует browser `sec-fetch-site`/`origin` напрямую в Railway;
- после проверки browser-origin выполняет второй hop как server-to-server запрос к Railway;
- `/readyz` проверяет реальный `/api/platform-health` Railway backend.

## Запуск на VPS

Требуются Docker, Docker Compose, домен с A/AAAA-записью на VPS и открытые порты 80/443.

```bash
cp .env.example .env
# Указать реальный GATEWAY_DOMAIN в .env
docker compose up -d --build
```

Caddy автоматически получает HTTPS-сертификат.

Проверка:

```bash
curl https://YOUR_DOMAIN/healthz
curl https://YOUR_DOMAIN/readyz
```

`/readyz` должен вернуть `ok:true`, `upstream.vk:true`, production environment и текущий release commit.

## Перед VK Hosting deploy

Публичный URL шлюза передаётся сборщику как `PIVNIK_VK_API_BASE`:

```bash
PIVNIK_VK_API_BASE=https://YOUR_DOMAIN npm run build:vk-hosting
```

Сборщик специально откажется собирать VK Hosting, если API base снова указывает на `*.up.railway.app` или `*.vercel.app`.

# VK Native Hosting migration runbook

Цель: убрать зависимость браузера пользователя VK от прямой доступности Railway/Vercel из России.

## Целевая схема

`VK -> VK Mini Apps Hosting -> Selectel RU HTTPS Gateway -> Vercel server relay -> Railway VK backend -> existing PostgreSQL`

Важно: Vercel в этой схеме не загружается браузером пользователя. Он используется только как server-to-server relay между Selectel и существующим Railway backend. На этом этапе Railway backend и production PostgreSQL не переносятся.

Проверка 2026-09-02 из Selectel `ru-3b`:

- прямой `Selectel -> Railway` устанавливает TCP/443, но зависает на TLS ClientHello;
- `Selectel -> pivnik-vk-proxy.vercel.app -> Railway` успешно возвращает HTTP 200;
- production metadata через relay: database fingerprint `7546c67ea9d5cfeb2792`, release commit `bd5ce4df161c724e3097ce70ebdde3bc458429b3`.

## 1. Dev gateway в Selectel без покупки домена

Рекомендуемая минимальная конфигурация для gateway:

- регион: Санкт-Петербург;
- сегмент: `ru-3b`;
- Ubuntu 24.04 LTS;
- 1 vCPU;
- 2 GB RAM;
- 25 GB SSD;
- прямой публичный IPv4;
- открытые входящие TCP 22, 80, 443.

При создании сервера передать содержимое `vk-api-gateway/selectel-cloud-init.yaml` как cloud-init/user-data.

Cloud-init автоматически:

1. устанавливает curl/tar/Docker;
2. забирает архив ветки `fix/vk-native-hosting-gateway` через GitHub archive endpoint с API fallback;
3. определяет публичный IPv4;
4. создаёт временный dev hostname `PUBLIC_IP.nip.io`;
5. запускает gateway + Caddy;
6. получает публичный HTTPS-сертификат;
7. направляет upstream через `https://pivnik-vk-proxy.vercel.app`;
8. проверяет `/healthz` и `/readyz` до существующего production backend.

После завершения установки адрес gateway можно получить на сервере:

```bash
cat /opt/pivnik-vk-gateway/vk-api-gateway/.env
docker compose -f /opt/pivnik-vk-gateway/vk-api-gateway/docker-compose.yml ps
```

Для диагностики cloud-init:

```bash
journalctl -u cloud-final.service --no-pager
```

`readyz` должен вернуть `ok:true`, `upstream.vk:true`, `environment:production`.

Критически важно открыть `https://PUBLIC_IP.nip.io/healthz` и `/readyz` с российского мобильного интернета без VPN до деплоя VK Hosting.

### Уже созданный сервер

Если `.env` был создан со старым прямым Railway upstream, переключить только upstream и пересоздать gateway container:

```bash
cd /opt/pivnik-vk-gateway/vk-api-gateway
sed -i 's#^RAILWAY_ORIGIN=.*#RAILWAY_ORIGIN=https://pivnik-vk-proxy.vercel.app#' .env
docker compose up -d --force-recreate gateway
curl -fsS https://$(grep '^GATEWAY_DOMAIN=' .env | cut -d= -f2)/readyz
```

Для production позже заменить `nip.io` на собственный стабильный домен; код gateway менять не требуется.

## 2. Собрать VK static bundle

```bash
PIVNIK_VK_API_BASE=https://GATEWAY_DOMAIN npm run build:vk-hosting
```

Сборка должна завершиться с `ok:true`. Она специально запрещает Railway/Vercel в качестве browser API base.

## 3. Сначала VK Hosting dev

В GitHub добавить repository secret:

`VK_MINI_APPS_ACCESS_TOKEN`

Используется официальный `@vkontakte/vk-miniapps-deploy@1.0.2`. CI принимает `MINI_APPS_ACCESS_TOKEN`; `MINI_APPS_ENVIRONMENT=dev` обновляет dev URL.

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

Параллельно проверить `gateway/readyz` и `/api/platform-health`: fingerprint БД и release commit должны соответствовать текущему production backend.

## 5. Production switch

Только после успешного dev E2E повторно запустить workflow:

- `environment` = `production`;
- `confirm` = `DEPLOY_VK_PRODUCTION`.

VK deploy tool сам обновляет production URL на URL нативного Hosting. Прямой Railway/Vercel URL в настройках запуска больше не использовать.

## 6. Rollback

Если native Hosting/gateway даёт дефект приложения, вернуть VK launch URL на предыдущую известную рабочую точку. Базу данных не откатывать. Railway backend не менять.

Gateway можно остановить независимо — он не хранит пользовательские данные и не является источником истины.

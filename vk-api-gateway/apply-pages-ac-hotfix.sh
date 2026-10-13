#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${PIVNIK_GATEWAY_DIR:-/opt/pivnik-vk-gateway}"
GATEWAY_DIR="$INSTALL_DIR/vk-api-gateway"
GATEWAY_URL="${PIVNIK_GATEWAY_URL:-https://139.100.238.159.nip.io}"
PROD_ORIGIN="${PIVNIK_VK_PRODUCTION_ORIGIN:-https://prod-app54694987-989ea78abfeb.pages-ac.vk-apps.ru}"
REPO_REF="${PIVNIK_REPO_REF:-main}"
SOURCE_URL="https://raw.githubusercontent.com/GrafTrahula666/pivnik-bonus-app/${REPO_REF}/vk-api-gateway/server.mjs"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi
if [ ! -d "$GATEWAY_DIR" ] || [ ! -f "$GATEWAY_DIR/docker-compose.yml" ]; then
  echo "Gateway install not found at $GATEWAY_DIR" >&2
  exit 1
fi

cd "$GATEWAY_DIR"
backup="server.mjs.backup-$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

cp -a server.mjs "$backup"
curl -fsSL --retry 5 --retry-delay 2 --connect-timeout 10 --max-time 60 "$SOURCE_URL" -o "$tmp"

grep -q "pages-ac.vk-apps.ru" "$tmp"
grep -q "pages-ac.vk-apps.com" "$tmp"
grep -q "VK Hosting Origin is required" "$tmp"
install -m 0644 "$tmp" server.mjs

rollback() {
  echo "Hotfix verification failed; restoring $backup" >&2
  cp -a "$backup" server.mjs
  docker compose up -d --build --force-recreate gateway >/dev/null
}
trap rollback ERR

docker compose up -d --build --force-recreate gateway

for attempt in $(seq 1 36); do
  if curl -fsS --max-time 5 "$GATEWAY_URL/healthz" >/dev/null 2>&1     && curl -fsS --max-time 10 "$GATEWAY_URL/readyz" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

curl -fsS --max-time 10 "$GATEWAY_URL/healthz" >/dev/null
curl -fsS --max-time 15 "$GATEWAY_URL/readyz" >/dev/null

headers="$(mktemp)"
body="$(mktemp)"
trap 'rm -f "$tmp" "$headers" "$body"' EXIT
code="$(curl --silent --show-error   --request OPTIONS   --header "Origin: $PROD_ORIGIN"   --header 'Access-Control-Request-Method: GET'   --header 'Access-Control-Request-Headers: authorization,content-type,x-pivnik-version,x-pivnik-platform,x-pivnik-explicit-consent,x-staff-session'   --dump-header "$headers" --output "$body"   --write-out '%{http_code}'   "$GATEWAY_URL/api/me")"

if [ "$code" != "204" ]; then
  echo "Expected CORS 204, got $code" >&2
  cat "$body" >&2 || true
  false
fi

allow_origin="$(awk 'BEGIN { IGNORECASE=1 } /^access-control-allow-origin:/ { sub(/\r$/, ""); sub(/^[^:]+:[[:space:]]*/, ""); print; exit }' "$headers")"
if [ "$allow_origin" != "$PROD_ORIGIN" ]; then
  echo "Unexpected allow-origin: $allow_origin" >&2
  false
fi

trap - ERR
echo "PIVNIK VK GATEWAY HOTFIX OK"
echo "Production origin allowed: $PROD_ORIGIN"
echo "Backup retained: $GATEWAY_DIR/$backup"

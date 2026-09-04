#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${PIVNIK_GATEWAY_DIR:-/opt/pivnik-vk-gateway}"
GATEWAY_DOMAIN="${GATEWAY_DOMAIN:-139.100.238.159.nip.io}"
API_BASE="https://${GATEWAY_DOMAIN}"
RAILWAY_ORIGIN="${RAILWAY_ORIGIN:-https://pivnik-vk-proxy.vercel.app}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$INSTALL_DIR"

docker run --rm \
  -e PIVNIK_VK_API_BASE="$API_BASE" \
  -v "$INSTALL_DIR:/work" \
  -w /work \
  node:24-bookworm-slim \
  bash -lc 'npm ci && npm run build:vk-hosting'

cd "$INSTALL_DIR/vk-api-gateway"
cat > .env <<EOF
GATEWAY_DOMAIN=$GATEWAY_DOMAIN
RAILWAY_ORIGIN=$RAILWAY_ORIGIN
GATEWAY_ALLOWED_ORIGINS=$API_BASE
UPSTREAM_TIMEOUT_MS=20000
MAX_BODY_BYTES=8388608
EOF

docker compose up -d --build --force-recreate

for attempt in $(seq 1 24); do
  if curl -fsS --max-time 5 "$API_BASE/healthz" >/dev/null 2>&1 \
    && curl -fsS --max-time 5 "$API_BASE/" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

echo "===== STATIC ====="
curl -fsSI --max-time 10 "$API_BASE/" | sed -n '1,12p'
echo "===== HEALTH ====="
curl -fsS --max-time 10 "$API_BASE/healthz"; echo
echo "===== READY ====="
curl -fsS --max-time 15 "$API_BASE/readyz"; echo

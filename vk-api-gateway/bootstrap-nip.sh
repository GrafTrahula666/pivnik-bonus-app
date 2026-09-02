#!/usr/bin/env bash
set -euo pipefail

REPO_REF="${PIVNIK_REPO_REF:-fix/vk-native-hosting-gateway}"
INSTALL_DIR="${PIVNIK_GATEWAY_DIR:-/opt/pivnik-vk-gateway}"
RAILWAY_ORIGIN="${RAILWAY_ORIGIN:-https://pivnik-vk-test-production-3474.up.railway.app}"
ARCHIVE_URL="${PIVNIK_ARCHIVE_URL:-https://codeload.github.com/GrafTrahula666/pivnik-bonus-app/tar.gz/refs/heads/${REPO_REF}}"
FALLBACK_ARCHIVE_URL="${PIVNIK_FALLBACK_ARCHIVE_URL:-https://api.github.com/repos/GrafTrahula666/pivnik-bonus-app/tarball/${REPO_REF}}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl tar docker.io
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-v2 || true
fi
if ! docker compose version >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

PUBLIC_IP="$(curl -4fsS --max-time 10 https://api.ipify.org)"
if ! [[ "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Could not determine public IPv4 address." >&2
  exit 1
fi

GATEWAY_DOMAIN="${GATEWAY_DOMAIN:-${PUBLIC_IP}.nip.io}"

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
archive="$(mktemp)"
cleanup() { rm -f "$archive"; }
trap cleanup EXIT

if ! curl -fL --retry 5 --retry-delay 2 --connect-timeout 10 --max-time 120 "$ARCHIVE_URL" -o "$archive"; then
  echo "Primary GitHub archive endpoint failed; trying API fallback." >&2
  curl -fL --retry 5 --retry-delay 2 --connect-timeout 10 --max-time 120 "$FALLBACK_ARCHIVE_URL" -o "$archive"
fi

tar -xzf "$archive" -C "$INSTALL_DIR" --strip-components=1

cd "$INSTALL_DIR/vk-api-gateway"
cat > .env <<EOF
GATEWAY_DOMAIN=$GATEWAY_DOMAIN
RAILWAY_ORIGIN=$RAILWAY_ORIGIN
GATEWAY_ALLOWED_ORIGINS=
UPSTREAM_TIMEOUT_MS=20000
MAX_BODY_BYTES=8388608
EOF

docker compose up -d --build

for attempt in $(seq 1 36); do
  if curl -fsS --max-time 5 "https://${GATEWAY_DOMAIN}/healthz" >/tmp/pivnik-gateway-health.json 2>/dev/null; then
    break
  fi
  sleep 5
done

if ! curl -fsS --max-time 10 "https://${GATEWAY_DOMAIN}/healthz" >/tmp/pivnik-gateway-health.json; then
  echo "Gateway did not become reachable over HTTPS." >&2
  docker compose ps >&2 || true
  docker compose logs --tail=80 >&2 || true
  exit 1
fi

curl -fsS --max-time 15 "https://${GATEWAY_DOMAIN}/readyz" >/tmp/pivnik-gateway-ready.json || {
  cat /tmp/pivnik-gateway-ready.json 2>/dev/null || true
  echo "Gateway is online but Railway readiness check failed." >&2
  exit 1
}

printf '\nPIVNIK VK GATEWAY READY\n'
printf 'Gateway: https://%s\n' "$GATEWAY_DOMAIN"
printf 'Health:  https://%s/healthz\n' "$GATEWAY_DOMAIN"
printf 'Ready:   https://%s/readyz\n' "$GATEWAY_DOMAIN"
printf 'VK API base for dev deploy: https://%s\n\n' "$GATEWAY_DOMAIN"
cat /tmp/pivnik-gateway-ready.json
printf '\n'

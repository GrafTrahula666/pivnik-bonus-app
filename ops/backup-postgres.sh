#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/pivnik-${STAMP}.dump"

command -v pg_dump >/dev/null 2>&1 || {
  echo "pg_dump is required" >&2
  exit 1
}
command -v sha256sum >/dev/null 2>&1 || {
  echo "sha256sum is required" >&2
  exit 1
}

mkdir -p "${BACKUP_DIR}"
umask 077

pg_dump \
  --dbname="${DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="${FILE}"

pg_restore --list "${FILE}" >/dev/null
sha256sum "${FILE}" > "${FILE}.sha256"

printf 'Backup created: %s\nChecksum: %s\n' "${FILE}" "${FILE}.sha256"

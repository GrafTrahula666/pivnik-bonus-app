#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"

if [[ "${CONFIRM_RESTORE:-}" != "RESTORE_PIVNIK" ]]; then
  echo "Set CONFIRM_RESTORE=RESTORE_PIVNIK to continue." >&2
  exit 1
fi

command -v pg_restore >/dev/null 2>&1 || {
  echo "pg_restore is required" >&2
  exit 1
}
command -v sha256sum >/dev/null 2>&1 || {
  echo "sha256sum is required" >&2
  exit 1
}

[[ -f "${BACKUP_FILE}" ]] || {
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
}
[[ -f "${BACKUP_FILE}.sha256" ]] || {
  echo "Checksum file not found: ${BACKUP_FILE}.sha256" >&2
  exit 1
}

sha256sum --check "${BACKUP_FILE}.sha256"
pg_restore --list "${BACKUP_FILE}" >/dev/null

pg_restore \
  --dbname="${RESTORE_DATABASE_URL}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "${BACKUP_FILE}"

printf 'Restore completed from: %s\n' "${BACKUP_FILE}"

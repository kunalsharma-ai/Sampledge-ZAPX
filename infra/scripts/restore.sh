#!/usr/bin/env bash
# Restore a backup made by backup.sh into the (empty) database at DATABASE_URL.
# Usage: DATABASE_URL=postgresql://... infra/scripts/restore.sh backups/zapx-....dump
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
FILE="${1:?backup file}"
URL="${DATABASE_URL%%\?*}"
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$URL" "$FILE"
echo "Restored $FILE"

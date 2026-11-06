#!/usr/bin/env bash
# Logical backup of the SampCode database (pg_dump custom format). Keeps the newest $KEEP files.
# Usage: DATABASE_URL=postgresql://... infra/scripts/backup.sh [backup-dir]
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
DIR="${1:-./backups}"
KEEP="${KEEP:-14}"
mkdir -p "$DIR"
FILE="$DIR/zapx-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Prisma-only query parameters are not understood by pg_dump.
URL="${DATABASE_URL%%\?*}"
pg_dump --format=custom --no-owner --no-privileges --file "$FILE" "$URL"
echo "Backup written: $FILE"
ls -1t "$DIR"/zapx-*.dump | tail -n +"$((KEEP + 1))" | xargs -r rm --

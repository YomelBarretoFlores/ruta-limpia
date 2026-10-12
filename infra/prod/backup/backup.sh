#!/bin/sh
# Dumps the application database and Traccar's database (pg_dump custom format), checks that each
# dump is readable, and rotates the copies: BACKUP_KEEP_DAILY daily (default 7) and
# BACKUP_KEEP_WEEKLY weekly (default 4, the Sunday dumps).
#
# Runs inside the `backup` service (postgres:16-alpine). Reads POSTGRES_USER, POSTGRES_PASSWORD,
# POSTGRES_DB (default ruta_limpia) and PGHOST (default db). Writes to /backups/{daily,weekly}.
# Manual run: docker compose -f infra/prod/docker-compose.prod.yml exec backup sh /opt/backup/backup.sh
set -eu
# Dumps hold personal data: readable by root only.
umask 077

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
export PGHOST="${PGHOST:-db}"
export PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PASSWORD"
APP_DB="${POSTGRES_DB:-ruta_limpia}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
ROOT=/backups

mkdir -p "$ROOT/daily" "$ROOT/weekly"
stamp=$(date +%Y%m%d-%H%M)

for db in "$APP_DB" traccar; do
  file="$ROOT/daily/$db-$stamp.dump"
  # Written under a temporary name, so a half-written dump never looks like a backup.
  pg_dump --format=custom --compress=6 --dbname="$db" --file="$file.partial"
  pg_restore --list "$file.partial" >/dev/null
  mv "$file.partial" "$file"
  echo "backup: $file ($(du -h "$file" | cut -f1))"
  # Sunday's dump is also kept as the weekly copy (a hard link: no extra space).
  if [ "$(date +%u)" = "7" ]; then
    ln -f "$file" "$ROOT/weekly/$db-$(date +%Y%m%d).dump"
  fi
  # Rotation: keep the newest copies of this database, delete the rest.
  ls -1 "$ROOT/daily/$db-"*.dump | sort -r | tail -n "+$((KEEP_DAILY + 1))" | xargs -r rm -f
  ls -1 "$ROOT/weekly/$db-"*.dump 2>/dev/null | sort -r | tail -n "+$((KEEP_WEEKLY + 1))" | xargs -r rm -f
done

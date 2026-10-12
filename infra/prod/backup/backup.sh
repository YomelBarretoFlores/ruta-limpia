#!/bin/sh
# Dumps the application database and Traccar's database (pg_dump custom format), each on its own:
# a failure of one never skips the other. Each dump is read back with `pg_restore --list` before
# it counts, and the copies are rotated per database: BACKUP_KEEP_DAILY daily (default 7) and
# BACKUP_KEEP_WEEKLY weekly (default 4, the Sunday dumps). Prints one OK or FAILED line per
# database and exits non-zero when any dump failed.
#
# Runs inside the `backup` service (postgres:16-alpine). Reads POSTGRES_USER, POSTGRES_PASSWORD,
# POSTGRES_DB (default ruta_limpia) and PGHOST (default db). Writes to /backups/{daily,weekly}.
# Manual run: $C exec backup sh /opt/backup/backup.sh (docs/ops/backup-restore.md)
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

# The dump being written. A dump is written under a temporary name, so a half-written one never
# looks like a backup; that file is removed when the dump fails or the run is interrupted.
partial=""
trap 'rm -f -- "$partial"; exit 1' HUP INT TERM

# Dumps one database, keeps the weekly copy and rotates that database's copies.
# Returns non-zero, with no partial file left, when the dump or its read-back fails.
dump_database() {
  db="$1"
  file="$ROOT/daily/$db-$stamp.dump"
  partial="$file.partial"
  if ! pg_dump --format=custom --compress=6 --dbname="$db" --file="$partial" ||
    ! pg_restore --list "$partial" >/dev/null ||
    ! mv "$partial" "$file"; then
    rm -f -- "$partial"
    partial=""
    return 1
  fi
  partial=""
  echo "backup: OK $db -> $file ($(du -h "$file" | cut -f1))"
  # Sunday's dump is also kept as the weekly copy (a hard link: no extra space).
  if [ "$(date +%u)" = "7" ]; then
    ln -f "$file" "$ROOT/weekly/$db-$(date +%Y%m%d).dump"
  fi
  # Rotation: keep the newest copies of this database, delete the rest. Only after a good dump,
  # so a failing database never loses its older copies.
  ls -1 "$ROOT/daily/$db-"*.dump | sort -r | tail -n "+$((KEEP_DAILY + 1))" | xargs -r rm -f
  ls -1 "$ROOT/weekly/$db-"*.dump 2>/dev/null | sort -r | tail -n "+$((KEEP_WEEKLY + 1))" | xargs -r rm -f
}

failed=""
for db in "$APP_DB" traccar; do
  if ! dump_database "$db"; then
    echo "backup: FAILED $db (see the pg_dump error above)" >&2
    failed="$failed $db"
  fi
done

# A partial file older than six hours is left over from a run that was killed (a dump of the
# pilot's databases takes seconds): it is not a backup and only fills the disk.
find "$ROOT/daily" -name '*.dump.partial' -mmin +360 -exec rm -f {} \;

if [ -n "$failed" ]; then
  echo "backup: FAILED for:$failed" >&2
  exit 1
fi

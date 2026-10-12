#!/bin/sh
# Restores one dump made by backup.sh into a database.
#
#   restore.sh <dump file> <target database> [--replace]
#
# Without --replace the target must not exist yet: it is created and filled (use this to check a
# backup, for example into ruta_limpia_restore_check). With --replace an existing database is
# dropped and recreated first: stop the API and Traccar before replacing ruta_limpia or traccar
# (docs/ops/backup-restore.md). Runs inside the `backup` service.
set -eu

if [ "$#" -lt 2 ]; then
  echo "usage: restore.sh <dump file> <target database> [--replace]" >&2
  exit 2
fi
dump="$1"
target="$2"
replace="${3:-}"
: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
export PGHOST="${PGHOST:-db}"
export PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PASSWORD"

[ -f "$dump" ] || { echo "restore: no such file: $dump" >&2; exit 1; }
pg_restore --list "$dump" >/dev/null

exists=$(psql --dbname=postgres --tuples-only --no-align \
  --command="SELECT 1 FROM pg_database WHERE datname = '$(printf '%s' "$target" | sed "s/'/''/g")'")
if [ "$exists" = "1" ]; then
  if [ "$replace" != "--replace" ]; then
    echo "restore: database $target exists; pass --replace to overwrite it" >&2
    exit 1
  fi
  dropdb --force "$target"
fi
createdb "$target"
pg_restore --no-owner --exit-on-error --dbname="$target" "$dump"
echo "restore: $dump -> $target done"

#!/bin/sh
# Restores one dump made by backup.sh into a database.
#
#   restore.sh <dump file> <target database> [--replace]
#
# The dump is always restored into a scratch database first (<target>_restoring). Only once that
# restore has finished does the copy take the target's name, so a restore that fails part-way
# (disk full, out of memory, a damaged dump) leaves the current database exactly as it was.
#
# Without --replace the target must not exist yet (use this to check a backup, for example into
# ruta_limpia_restore_check). With --replace an existing target is swapped for the restored copy
# and then dropped: stop the API and Traccar before replacing ruta_limpia or traccar
# (docs/ops/backup-restore.md). Runs inside the `backup` service.
set -eu

usage() {
  echo "usage: restore.sh <dump file> <target database> [--replace]" >&2
  exit 2
}
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
dump="$1"
target="$2"
replace="${3:-}"
[ -z "$replace" ] || [ "$replace" = "--replace" ] || usage
# Plain lower-case names only, so they are safe in SQL without quoting.
case "$target" in
  '' | [!a-z_]* | *[!a-z0-9_]*)
    echo "restore: the database name may hold only a-z, 0-9 and _: '$target'" >&2
    exit 2
    ;;
esac
[ "${#target}" -le 48 ] || { echo "restore: database name longer than 48 characters" >&2; exit 2; }

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
export PGHOST="${PGHOST:-db}"
export PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PASSWORD"

sql() {
  psql --dbname=postgres --no-psqlrc --quiet --tuples-only --no-align -v ON_ERROR_STOP=1 \
    --command="$1"
}
exists() {
  [ "$(sql "SELECT 1 FROM pg_database WHERE datname = '$1'")" = "1" ]
}

[ -f "$dump" ] || { echo "restore: no such file: $dump" >&2; exit 1; }
pg_restore --list "$dump" >/dev/null
if exists "$target" && [ "$replace" != "--replace" ]; then
  echo "restore: database $target exists; pass --replace to overwrite it" >&2
  exit 1
fi

scratch="${target}_restoring"
previous="${target}_previous"
# A scratch copy left by an interrupted run is incomplete: start again from the dump.
dropdb --if-exists --force "$scratch"
createdb "$scratch"
if ! pg_restore --no-owner --exit-on-error --dbname="$scratch" "$dump"; then
  dropdb --if-exists --force "$scratch"
  echo "restore: FAILED; $target was not changed" >&2
  exit 1
fi

if exists "$target"; then
  dropdb --if-exists --force "$previous"
  # Close what still holds the target (the API and Traccar should already be stopped).
  sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = '$target' AND pid <> pg_backend_pid()" >/dev/null
  if ! sql "ALTER DATABASE $target RENAME TO $previous"; then
    echo "restore: $target is in use, so it was not changed; stop the API and Traccar and run" \
      "again (the restored copy stays as $scratch until then)" >&2
    exit 1
  fi
  if ! sql "ALTER DATABASE $scratch RENAME TO $target"; then
    sql "ALTER DATABASE $previous RENAME TO $target"
    echo "restore: FAILED to swap in the restored copy; $target was not changed" >&2
    exit 1
  fi
  dropdb --force "$previous"
else
  sql "ALTER DATABASE $scratch RENAME TO $target"
fi
echo "restore: $dump -> $target done"

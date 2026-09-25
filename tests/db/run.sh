#!/usr/bin/env bash
# Startet ein temporäres Postgres, spielt Stub + Migration ein und führt die RLS-Tests aus.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$TMP"; RUN="runuser -u postgres --"
else
  RUN=""
fi
cleanup() { $RUN "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
$RUN "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$HERE/supabase-stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -o /dev/null -f "$HERE/rls-tests.sql"
echo "Alle Datenbank-Tests bestanden."

#!/usr/bin/env bash
# Applies the migrations to a scratch Postgres database and runs the SQL
# scenario checks (*_test.sql, in name order). Needs psql and a Postgres
# server you can create databases on.
# Usage: PGURL=postgres://postgres@localhost:5432 supabase/tests/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
base="${PGURL:-postgres://postgres@localhost:5432}"
db="${TEST_DB:-eq_scoreboard_test}"

psql "$base/postgres" -qc "drop database if exists $db" -c "create database $db"
args=(-v ON_ERROR_STOP=1 -q -o /dev/null -d "$base/$db" -f "$here/auth_stub.sql")
for m in "$here"/../migrations/*.sql; do args+=(-f "$m"); done
if [ "${MIGRATE_ONLY:-}" != "1" ]; then
  for t in "$here"/*_test.sql; do args+=(-f "$t"); done
fi
psql "${args[@]}"
echo "All database checks passed."

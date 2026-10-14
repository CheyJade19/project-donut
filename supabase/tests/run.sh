#!/usr/bin/env bash
# Applies the migrations to a scratch Postgres database and runs the RLS
# scenario checks. Needs psql and a Postgres server you can create databases on.
# Usage: PGURL=postgres://postgres@localhost:5432 supabase/tests/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
base="${PGURL:-postgres://postgres@localhost:5432}"
db="eq_scoreboard_test"

psql "$base/postgres" -qc "drop database if exists $db" -c "create database $db"
args=(-v ON_ERROR_STOP=1 -q -o /dev/null -d "$base/$db" -f "$here/auth_stub.sql")
for m in "$here"/../migrations/*.sql; do args+=(-f "$m"); done
args+=(-f "$here/rls_test.sql")
psql "${args[@]}"
echo "All database checks passed."

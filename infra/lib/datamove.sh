# Copies the database at NEON_DIRECT_URL into the target database and checks that every table has as many rows on
# both sides. Runs in the official postgres image as a one-off ECS task (lib/app.ts, docs/aws/production.md); the
# target comes from the libpq variables PGHOST, PGDATABASE, PGUSER (the app's user, so it owns what is restored),
# PGPASSWORD and PGSSLMODE. Exits non-zero on any failure or when the counts differ.
set -eu
dump=/tmp/source.dump
pg_dump --format=custom --no-owner --no-privileges --file="$dump" "$NEON_DIRECT_URL"
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$PGDATABASE" "$dump"
count="SELECT coalesce(string_agg(table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text, ',' ORDER BY table_name), '') FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
source=$(psql "$NEON_DIRECT_URL" -X -t -A -v ON_ERROR_STOP=1 -c "$count")
target=$(psql -X -t -A -v ON_ERROR_STOP=1 -c "$count")
echo "source: $source"
echo "target: $target"
if [ "$source" != "$target" ]; then
  echo "The row counts differ." >&2
  exit 1
fi
echo "The row counts match."

#!/bin/sh
# The entrypoint of the container image (Dockerfile). On ECS the database's address and credentials come one by one
# (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, from the RDS secret; its password has no characters that need
# escaping in a URL), and DATABASE_URL is made from them. A DATABASE_URL given to the container is used as it is.
# Then the pending migrations are applied (scripts/migrate.cjs holds a lock, so tasks starting together wait for each
# other), as `npm run db:migrate` does before a Vercel build, and the server starts.
set -eu

if [ -z "${DATABASE_URL:-}" ] && [ -n "${DB_HOST:-}" ]; then
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME:-typle}?sslmode=${DB_SSLMODE:-verify-full}"
  export DATABASE_URL
fi

if [ "${TYPLE_MIGRATE_ON_START:-1}" = "1" ]; then
  node scripts/migrate.cjs
fi

exec "$@"

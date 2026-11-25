// Runs before `prisma migrate deploy` (npm run db:migrate) and stops when the database has applied migrations newer
// than every migration of this checkout: the code is older than the database, as when an old commit is deployed to
// production. Prisma Migrate applies nothing in that case but still succeeds, and the old code would then run on the
// new tables. On 2026-10-31 the sources of v0.99.4 were deployed and 0002_practice_devices failed on production
// (docs/release-workflow.md).
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')

/** The migrations this checkout has, by name. */
function localMigrations(dir = path.join(root, 'db/migrations')) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
}

/**
 * The applied migrations that are newer than every migration of this checkout. Names start with a zero-padded number,
 * so they sort in the order they were made. Older ones that are no longer here (0001 to 0026, which 0027_schema
 * replaced) are fine: production keeps their records.
 */
function newerThanLocal(applied, local) {
  const latest = [...local].sort().at(-1)
  return applied.filter(name => latest === undefined || name > latest).sort()
}

/** The names of the migrations the database records as applied; none in a new database. */
async function appliedMigrations(client) {
  const { rows: [{ exists }] } = await client.query("SELECT to_regclass('_prisma_migrations') IS NOT NULL AS exists")
  if (!exists) return []
  const { rows } = await client.query(
    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
  return rows.map(row => row.migration_name)
}

async function main() {
  require('@next/env').loadEnvConfig(root)
  // The same database as prisma.config.ts.
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!connectionString) throw new Error('Set DIRECT_URL or DATABASE_URL to the database to migrate.')
  const { Client } = require('pg')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const newer = newerThanLocal(await appliedMigrations(client), localMigrations())
    if (newer.length > 0) {
      throw new Error(`The database has migrations this checkout does not have: ${newer.join(', ')}.\n` +
        'This code is older than the database. Deploy the latest main instead; no migration was applied.')
    }
  } finally {
    await client.end()
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { appliedMigrations, localMigrations, newerThanLocal }

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { Client } = require('pg')
const { appliedMigrations, localMigrations, newerThanLocal } = require('../scripts/check-migrations.cjs')

const root = path.join(__dirname, '..')
const migrations = path.join(root, 'db/migrations')

test('migrations of this checkout are listed by name', () => {
  const local = localMigrations()
  assert.ok(local.includes('0027_schema'))
  assert.deepEqual(local, [...local].sort())
  // Names sort in the order they were made only while the numbers keep the same width.
  assert.ok(local.every(name => /^\d{4}_/.test(name)), local.join(', '))
})

test('new migrations are one transaction each', () => {
  // Prisma Migrate does not wrap a migration in a transaction: without BEGIN and COMMIT a failure leaves it half done.
  // The migrations up to 0040_sid_links were applied before and keep their checksums.
  for (const name of localMigrations().filter(name => name > '0040_sid_links')) {
    const sql = fs.readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8').trim()
    assert.match(sql, /^BEGIN;/, `${name} starts with BEGIN;`)
    assert.match(sql, /COMMIT;$/, `${name} ends with COMMIT;`)
  }
})

test('a database at the same migrations or behind them is not refused', () => {
  const local = ['0027_schema', '0028_admins', '0029_admins_ffpf']
  assert.deepEqual(newerThanLocal([], local), [])
  assert.deepEqual(newerThanLocal(['0027_schema'], local), [])
  assert.deepEqual(newerThanLocal(['0027_schema', '0028_admins', '0029_admins_ffpf'], local), [])
})

test('records of the migrations 0027_schema replaced are not refused', () => {
  // Production applied 0001 to 0026 before they were squashed into 0027_schema and keeps their records.
  const applied = ['0001_workspaces', '0002_practice_devices', '0026_interests', '0027_schema', '0028_admins']
  assert.deepEqual(newerThanLocal(applied, ['0027_schema', '0028_admins']), [])
})

test('an older checkout than the database is refused with the migrations it lacks', () => {
  // v0.99.4 still had 0001 to 0026 only; production has 0027_schema and later.
  const old = ['0001_workspaces', '0002_practice_devices', '0026_interests']
  const applied = ['0001_workspaces', '0027_schema', '0032_drop_legacy', '0028_admins']
  assert.deepEqual(newerThanLocal(applied, old), ['0027_schema', '0028_admins', '0032_drop_legacy'])
  assert.deepEqual(newerThanLocal(['0999_next'], localMigrations()), ['0999_next'])
})

test('the Prisma CLI checks the certificate where the app does', async () => {
  const { prismaUrl } = await import('../prisma.config.ts')
  // DATABASE_URL on AWS, in libpq's form, which pg reads and the Prisma CLI ignores.
  const aws = 'postgresql://typle_app:pw@db.example:5432/typle?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem'
  const converted = new URL(prismaUrl(aws)).searchParams
  assert.equal(converted.get('sslmode'), 'require')
  assert.equal(converted.get('sslcert'), '/app/certs/rds-global-bundle.pem')
  assert.equal(converted.get('sslaccept'), 'strict')
  assert.equal(converted.get('sslrootcert'), null)
  for (const url of ['postgresql://typle:pw@127.0.0.1:5433/typle', 'postgresql://u:pw@ep.neon.tech/neondb?sslmode=require']) {
    assert.equal(prismaUrl(url), url)
  }
})

// The rest runs against a real database: `TYPLE_TEST_DATABASE_URL=… node --test tests/migrate.test.cjs`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }

/** Runs body with a client and a connection string for a schema of its own, dropped afterwards. */
async function inEmptySchema(body) {
  const client = new Client({ connectionString: url })
  await client.connect()
  const schema = `migrate_test_${process.pid}`
  const schemaUrl = new URL(url)
  schemaUrl.searchParams.set('schema', schema)
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await client.query(`CREATE SCHEMA ${schema}`)
    await client.query(`SET search_path TO ${schema}`)
    await body(client, schemaUrl.toString())
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await client.end()
  }
}

/** `prisma migrate deploy` of this checkout on the database at databaseUrl, as npm run db:migrate runs it. */
function deploy(databaseUrl) {
  const result = spawnSync(path.join(root, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, DIRECT_URL: databaseUrl },
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

const recorded = async client =>
  (await client.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1')).rows.map(row => row.migration_name)
const hasTable = async (client, name) => (await client.query('SELECT to_regclass($1) IS NOT NULL AS found', [name])).rows[0].found

test('a new database gets every migration, and a second run changes nothing', database, () => inEmptySchema(async (client, schemaUrl) => {
  assert.deepEqual(await appliedMigrations(client), [])
  const first = deploy(schemaUrl)
  assert.equal(first.status, 0, first.output)
  assert.deepEqual(await recorded(client), localMigrations())
  assert.ok(await hasTable(client, 'typle_workspaces'))
  assert.deepEqual((await appliedMigrations(client)).sort(), localMigrations())
  const second = deploy(schemaUrl)
  assert.equal(second.status, 0, second.output)
  assert.match(second.output, /No pending migrations to apply/)
}))

test('records of migrations this checkout no longer has are kept and accepted', database, () => inEmptySchema(async (client, schemaUrl) => {
  assert.equal(deploy(schemaUrl).status, 0)
  // As production's 0001 to 0026.
  await client.query(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
    VALUES ('old', 'x', now(), '0001_workspaces', 1)`)
  const result = deploy(schemaUrl)
  assert.equal(result.status, 0, result.output)
  assert.deepEqual(newerThanLocal(await appliedMigrations(client), localMigrations()), [])
}))

test('a database newer than the checkout is found by the check, which Prisma Migrate does not do', database, () => inEmptySchema(async (client, schemaUrl) => {
  assert.equal(deploy(schemaUrl).status, 0)
  await client.query(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
    VALUES ('future', 'x', now(), '9999_future', 1)`)
  assert.deepEqual(newerThanLocal(await appliedMigrations(client), localMigrations()), ['9999_future'])
  // Why scripts/check-migrations.cjs runs first: Prisma Migrate succeeds here.
  assert.equal(deploy(schemaUrl).status, 0)
}))

test('a failed migration stops Prisma Migrate until it is resolved', database, () => inEmptySchema(async (client, schemaUrl) => {
  assert.equal(deploy(schemaUrl).status, 0)
  await client.query("INSERT INTO _prisma_migrations (id, checksum, migration_name) VALUES ('failed', 'x', '0041_failed')")
  const result = deploy(schemaUrl)
  assert.notEqual(result.status, 0)
  assert.match(result.output, /P3009/)
  // A failed migration is not counted as applied.
  assert.ok(!(await appliedMigrations(client)).includes('0041_failed'))
}))

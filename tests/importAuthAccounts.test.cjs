const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomInt, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')

const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const sql = url ? new Pool({ connectionString: url }) : null
const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/0043_import_auth_accounts/migration.sql'), 'utf8')

// Random ids keep this test apart from other data in the same database.
const n = randomInt(1e9, 2e9)
const github = `github:${n}`
const sidOnly = `sid:t${n}`
const password = `password:${randomUUID()}`
const ffpf = `ffpf:t${n}`
const linkedOnly = `github:${n + 1}`
const odd = `weird:${n}`
const subLinked = `zz${n}`
const subOrphan = `yy${n}`
const ids = [github, sidOnly, password, ffpf, linkedOnly, odd]

after(async () => {
  if (!sql) return
  await sql.query('DELETE FROM typle_auth_users WHERE id = ANY($1)', [[...ids, `sid:${subLinked}`]])
  await sql.query('DELETE FROM typle_sid_links WHERE sub = ANY($1)', [[subLinked, subOrphan]])
  await sql.query('DELETE FROM typle_records WHERE owner_id = ANY($1)', [ids])
  await sql.query('DELETE FROM typle_workspaces WHERE owner_id = ANY($1)', [ids])
  await sql.end()
})

async function seed() {
  for (const id of [github, password, odd]) await sql.query('INSERT INTO typle_workspaces (owner_id) VALUES ($1) ON CONFLICT DO NOTHING', [id])
  for (const id of [sidOnly, ffpf]) {
    await sql.query(
      "INSERT INTO typle_records (owner_id, list_id, record_id, position, at, data) VALUES ($1, 'l', 'r', 0, now(), '{}') ON CONFLICT DO NOTHING", [id])
  }
  // linkedOnly has no data: its link alone must keep the account. subOrphan links to an id of the wrong shape.
  await sql.query('INSERT INTO typle_sid_links (sub, account_id) VALUES ($1, $2), ($3, $4), ($5, $6) ON CONFLICT DO NOTHING',
    [subLinked, github, `l${n}`, linkedOnly, subOrphan, odd])
}
const state = async () => {
  const users = await sql.query('SELECT id, email, email_verified, name FROM typle_auth_users WHERE id = ANY($1) ORDER BY id', [ids])
  const accounts = await sql.query(
    'SELECT provider_id, account_id, user_id FROM typle_auth_accounts WHERE user_id = ANY($1) ORDER BY provider_id, account_id', [ids])
  return { users: users.rows, accounts: accounts.rows }
}

test('import migration creates users and accounts', database, async () => {
  await seed()
  await sql.query(migration)
  const { users, accounts } = await state()
  const verified = id => ({ id, email: `${id}@users.invalid`, email_verified: true, name: '' })
  assert.deepEqual(users, [github, linkedOnly, password, sidOnly, ffpf].sort().map(verified))
  assert.deepEqual(accounts, [
    { provider_id: 'github', account_id: String(n), user_id: github },
    { provider_id: 'github', account_id: String(n + 1), user_id: linkedOnly },
    { provider_id: 'sid', account_id: `l${n}`, user_id: linkedOnly },
    { provider_id: 'sid', account_id: `t${n}`, user_id: sidOnly },
    { provider_id: 'sid', account_id: subLinked, user_id: github },
  ])
})

test('import migration is idempotent', database, async () => {
  await seed()
  await sql.query(migration)
  const before = await state()
  await sql.query(migration)
  assert.deepEqual(await state(), before)
})

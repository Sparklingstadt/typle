require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomInt } = require('node:crypto')
const { createPool, createPrisma } = require('../src/server/database.ts')
const { databaseLabel, linkSid, parseSub } = require('../scripts/sid-link.cjs')

// npm run sid:link: adds a ('sid', sub) row of typle_auth_accounts to the user of another login, which Better Auth
// reads at a Sparklingstadt ID login. Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
// The code under test gets Prisma Client; the tests set up and look at the tables with SQL.
const sql = url ? createPool(url) : null
const db = url ? createPrisma(url) : null
const subs = []
const owners = []
after(async () => {
  if (!db) return
  await sql.query('DELETE FROM typle_auth_users WHERE id = ANY($1)', [[...owners, ...subs.map(sub => `sid:${sub}`)]])
  await sql.query('DELETE FROM typle_workspaces WHERE owner_id = ANY($1)', [owners])
  await sql.query('DELETE FROM typle_records WHERE owner_id = ANY($1)', [owners])
  await sql.end()
  await db.$disconnect()
})

const newSub = () => {
  const sub = `t${randomInt(1e9, 2e9)}`
  subs.push(sub)
  return sub
}
/** A GitHub user with a saved workspace, or with nothing saved when empty, or no user row when missing. */
async function newAccount({ empty = false, missing = false } = {}) {
  const owner = `github:${randomInt(1e9, 2e9)}`
  owners.push(owner)
  if (!missing) await sql.query('INSERT INTO typle_auth_users (id, name, email) VALUES ($1, $1, $2)', [owner, `${owner}@users.invalid`])
  if (!empty) await sql.query('INSERT INTO typle_workspaces (owner_id) VALUES ($1)', [owner])
  return owner
}

test('a sub is taken with or without sid:, and only in its own form', () => {
  assert.equal(parseSub('sid:cm3abc'), 'cm3abc')
  assert.equal(parseSub('cm3abc'), 'cm3abc')
  for (const text of ['SID:x', '', 'sid:', 'a b', 'ABC', 'a'.repeat(65)]) assert.equal(parseSub(text), null, text)
})

test('the result names the database it was written to, without the user or password', () => {
  assert.equal(databaseLabel('postgresql://u:secret@ep-x.neon.tech/neondb?sslmode=require'), 'ep-x.neon.tech/neondb')
  assert.equal(databaseLabel('postgresql://u:secret@127.0.0.1:5433/typle'), '127.0.0.1:5433/typle')
  assert.equal(databaseLabel('not a url'), '?')
})

const sidAccounts = async sub => (await sql.query("SELECT user_id FROM typle_auth_accounts WHERE provider_id = 'sid' AND account_id = $1", [sub])).rows.map(row => row.user_id)

test('sid:link adds the sid account to the github user', database, async () => {
  const sub = newSub()
  const owner = await newAccount()
  assert.deepEqual(await sidAccounts(sub), [])
  assert.equal(await linkSid(db, sub, owner), 'linked')
  assert.deepEqual(await sidAccounts(sub), [owner])
})

test('sid:link refuses a sub already linked, and an account that has a sid account already', database, async () => {
  const sub = newSub()
  const owner = await newAccount()
  assert.equal(await linkSid(db, sub, owner), 'linked')
  assert.equal(await linkSid(db, sub, await newAccount()), 'subLinked')
  assert.equal(await linkSid(db, newSub(), owner), 'accountLinked')
  assert.deepEqual(await sidAccounts(sub), [owner])
})

test('sid:link refuses a target that is not a user', database, async () => {
  const sub = newSub()
  assert.equal(await linkSid(db, sub, await newAccount({ missing: true })), 'accountMissing')
  assert.deepEqual(await sidAccounts(sub), [])
})

test('an account with an account record but no workspace can be linked', database, async () => {
  const owner = await newAccount({ empty: true })
  await sql.query(`INSERT INTO typle_records (owner_id, list_id, record_id, position, at, data)
    VALUES ($1, 'l', 'r', 0, now(), '{}')`, [owner])
  assert.equal(await linkSid(db, newSub(), owner), 'linked')
})

test('sid:link refuses a target without saved data, as a mistyped one', database, async () => {
  assert.equal(await linkSid(db, newSub(), await newAccount({ empty: true })), 'accountEmpty')
})

test('sid:link refuses when sid:<sub> already has data, as the link would leave that data behind', database, async () => {
  const sub = newSub()
  owners.push(`sid:${sub}`)
  await sql.query('INSERT INTO typle_workspaces (owner_id) VALUES ($1)', [`sid:${sub}`])
  assert.equal(await linkSid(db, sub, await newAccount()), 'sidHasData')
})

test('only an account of another login can be linked to', database, async () => {
  for (const account of ['sid:abc', 'github:', 'x:1', '', 'password:not-a-uuid']) {
    assert.equal(await linkSid(db, newSub(), account), 'accountInvalid', account)
  }
})

test('a sid:<sub> user that signed in before with nothing saved is replaced by the link', database, async () => {
  const sub = newSub()
  const own = `sid:${sub}`
  await sql.query('INSERT INTO typle_auth_users (id, name, email) VALUES ($1, $1, $2)', [own, `${own}@users.invalid`])
  await sql.query("INSERT INTO typle_auth_accounts (id, account_id, provider_id, user_id) VALUES ($1, $2, 'sid', $3)", [`t-${sub}`, sub, own])
  const owner = await newAccount()
  assert.equal(await linkSid(db, sub, owner), 'linked')
  assert.deepEqual(await sidAccounts(sub), [owner])
  assert.equal((await sql.query('SELECT 1 FROM typle_auth_users WHERE id = $1', [own])).rowCount, 0)
})

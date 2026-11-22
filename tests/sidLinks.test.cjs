require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomInt } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { linkedAccount } = require('../src/server/sidLinks.ts')
const { databaseLabel, linkSid, parseSub } = require('../scripts/sid-link.cjs')

// The links of Sparklingstadt ID accounts to the accounts of the other logins (typle_sid_links): what the login reads
// and what npm run sid:link adds. Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const subs = []
const owners = []
after(async () => {
  if (!db) return
  await db.query('DELETE FROM typle_sid_links WHERE sub = ANY($1)', [subs])
  await db.query('DELETE FROM typle_workspaces WHERE owner_id = ANY($1)', [owners])
  await db.query('DELETE FROM typle_records WHERE owner_id = ANY($1)', [owners])
  await db.end()
})

const newSub = () => {
  const sub = `t${randomInt(1e9, 2e9)}`
  subs.push(sub)
  return sub
}
/** A GitHub account with a saved workspace, or with nothing saved when empty. */
async function newAccount({ empty = false } = {}) {
  const owner = `github:${randomInt(1e9, 2e9)}`
  owners.push(owner)
  if (!empty) await db.query('INSERT INTO typle_workspaces (owner_id) VALUES ($1)', [owner])
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

test('a linked sub signs in as its account; a sub without a link has none', database, async () => {
  const sub = newSub()
  const owner = await newAccount()
  assert.equal(await linkedAccount(db, sub), null)
  assert.equal(await linkSid(db, sub, owner), 'linked')
  assert.equal(await linkedAccount(db, sub), owner)
})

test('a sub links once, and an account to one sub', database, async () => {
  const sub = newSub()
  const owner = await newAccount()
  assert.equal(await linkSid(db, sub, owner), 'linked')
  assert.equal(await linkSid(db, sub, await newAccount()), 'subLinked')
  assert.equal(await linkSid(db, newSub(), owner), 'accountLinked')
})

test('an account with an account record but no workspace can be linked', database, async () => {
  const owner = await newAccount({ empty: true })
  await db.query(`INSERT INTO typle_records (owner_id, list_id, record_id, position, at, data)
    VALUES ($1, 'l', 'r', 0, now(), '{}')`, [owner])
  assert.equal(await linkSid(db, newSub(), owner), 'linked')
})

test('an account with nothing saved is refused, as a mistyped one', database, async () => {
  assert.equal(await linkSid(db, newSub(), await newAccount({ empty: true })), 'accountEmpty')
})

test('a sub whose own account sid:<sub> has saved data is refused, as the link would leave that data behind', database, async () => {
  const sub = newSub()
  owners.push(`sid:${sub}`)
  await db.query('INSERT INTO typle_workspaces (owner_id) VALUES ($1)', [`sid:${sub}`])
  assert.equal(await linkSid(db, sub, await newAccount()), 'sidHasData')
})

test('only an account of another login can be linked to', database, async () => {
  for (const account of ['sid:abc', 'github:', 'x:1', '', 'password:not-a-uuid']) {
    assert.equal(await linkSid(db, newSub(), account), 'accountInvalid', account)
  }
})

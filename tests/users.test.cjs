require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { createUser, findUserByLoginId, findUserById, setPassword, markEmailVerified, findVerifiedLoginIdsByEmail } = require('../src/server/users.ts')

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const prefix = `t${randomUUID().slice(0, 8).replace(/-/g, '')}`
after(async () => {
  if (!db) return
  await db.query('DELETE FROM typle_users WHERE login_id LIKE $1', [`${prefix}%`])
  await db.end()
})
const make = (name, email = `${prefix}${name}@example.com`) => ({ loginId: `${prefix}${name}`, email, passwordHash: 'h', locale: 'ja' })

test('a second account with the same ID is taken', database, async () => {
  const first = await createUser(db, make('dup'))
  assert.equal(typeof first.id, 'string')
  assert.equal(await createUser(db, make('dup')), 'taken')
  const found = await findUserByLoginId(db, `${prefix}dup`)
  assert.equal(found.id, first.id)
  assert.equal(found.emailVerifiedAt, null)
  assert.deepEqual(await findUserById(db, first.id), found)
  assert.equal(await findUserById(db, 'not-a-uuid'), null)
  assert.equal(await findUserByLoginId(db, `${prefix}none`), null)
})

test('the password is replaced', database, async () => {
  const { id } = await createUser(db, make('pw'))
  await setPassword(db, id, 'new')
  assert.equal((await findUserById(db, id)).passwordHash, 'new')
})

test('only verified addresses list their IDs, and only for the current address', database, async () => {
  const email = `${prefix}shared@example.com`
  const a = await createUser(db, make('va', email))
  await createUser(db, make('vb', email))
  assert.deepEqual(await findVerifiedLoginIdsByEmail(db, email), [])
  await markEmailVerified(db, a.id, `${prefix}other@example.com`)
  assert.deepEqual(await findVerifiedLoginIdsByEmail(db, email), [])
  await markEmailVerified(db, a.id, email)
  assert.deepEqual(await findVerifiedLoginIdsByEmail(db, email), [`${prefix}va`])
})

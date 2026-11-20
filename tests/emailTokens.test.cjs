require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { createUser } = require('../src/server/users.ts')
const { issueToken, consumeToken, pruneTokens } = require('../src/server/emailTokens.ts')

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const prefix = `t${randomUUID().slice(0, 8).replace(/-/g, '')}`
after(async () => {
  if (!db) return
  // Tokens go with their users (ON DELETE CASCADE).
  await db.query('DELETE FROM typle_users WHERE login_id LIKE $1', [`${prefix}%`])
  await db.end()
})
const user = async name => {
  const email = `${prefix}${name}@example.com`
  const { id } = await createUser(db, { loginId: `${prefix}${name}`, email, passwordHash: 'h', locale: 'ja' })
  return { id, email }
}

test('a token is used once and the database keeps only its hash', database, async () => {
  const { id, email } = await user('once')
  const raw = await issueToken(db, { userId: id, kind: 'verify', email, ttlSeconds: 60 })
  assert.match(raw, /^[A-Za-z0-9_-]{43}$/)
  const { rows } = await db.query('SELECT token_hash FROM typle_email_tokens WHERE user_id = $1', [id])
  assert.equal(rows.length, 1)
  assert.notEqual(rows[0].token_hash, raw)
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/)
  assert.deepEqual(await consumeToken(db, raw, 'verify'), { userId: id, email })
  assert.equal(await consumeToken(db, raw, 'verify'), null)
})

test('a token of another kind is refused and stays usable', database, async () => {
  const { id, email } = await user('kind')
  const raw = await issueToken(db, { userId: id, kind: 'reset', email, ttlSeconds: 60 })
  assert.equal(await consumeToken(db, raw, 'verify'), null)
  assert.deepEqual(await consumeToken(db, raw, 'reset'), { userId: id, email })
})

test('an expired token is refused', database, async () => {
  const { id, email } = await user('exp')
  const raw = await issueToken(db, { userId: id, kind: 'reset', email, ttlSeconds: 60 })
  assert.equal(await consumeToken(db, raw, 'reset', new Date(Date.now() + 61_000)), null)
  assert.deepEqual(await consumeToken(db, raw, 'reset'), { userId: id, email })
})

test('an unknown token is refused, and tokens are random', database, async () => {
  assert.equal(await consumeToken(db, 'nope', 'verify'), null)
  const { id, email } = await user('rand')
  const a = await issueToken(db, { userId: id, kind: 'verify', email, ttlSeconds: 60 })
  const b = await issueToken(db, { userId: id, kind: 'verify', email, ttlSeconds: 60 })
  assert.notEqual(a, b)
})

test('concurrent consumption succeeds exactly once', database, async () => {
  const { id, email } = await user('race')
  const raw = await issueToken(db, { userId: id, kind: 'reset', email, ttlSeconds: 60 })
  const results = await Promise.all(Array.from({ length: 5 }, () => consumeToken(db, raw, 'reset')))
  assert.equal(results.filter(Boolean).length, 1)
})

test('pruneTokens deletes the tokens that expired or were used over a day ago', database, async () => {
  const { id, email } = await user('prune')
  const insert = (hash, expires, used) => db.query(
    "INSERT INTO typle_email_tokens (token_hash, user_id, kind, email, expires_at, used_at) VALUES ($1, $2, 'reset', $3, $4, $5)",
    [hash, id, email, expires, used])
  const now = new Date()
  const ago = seconds => new Date(now.getTime() - seconds * 1000)
  await insert(`${prefix}expired`, ago(2 * 86400), null)
  await insert(`${prefix}used`, new Date(now.getTime() + 3600_000), ago(2 * 86400))
  await insert(`${prefix}recent`, ago(3600), ago(3600))
  await insert(`${prefix}live`, new Date(now.getTime() + 3600_000), null)
  await pruneTokens(db, now)
  const { rows } = await db.query('SELECT token_hash FROM typle_email_tokens WHERE user_id = $1 ORDER BY token_hash', [id])
  assert.deepEqual(rows.map(row => row.token_hash), [`${prefix}live`, `${prefix}recent`])
})

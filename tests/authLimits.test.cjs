require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { isBlocked, countHit, undoHit, clearHits, clientIp, pruneLimits, LIMITS } = require('../src/server/limits.ts')

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const prefix = `t${randomUUID().slice(0, 8).replace(/-/g, '')}`
after(async () => {
  if (!db) return
  await db.query('DELETE FROM typle_auth_limits WHERE key LIKE $1', [`%${prefix}%`])
  await db.end()
})
const T0 = new Date('2026-01-01T00:00:00Z')
const after_ = (base, seconds) => new Date(base.getTime() + seconds * 1000)

test('five failures for an ID block it for 15 minutes', database, async () => {
  const limit = LIMITS.loginFailId(`${prefix}a`)
  for (let i = 0; i < 4; i++) assert.deepEqual(await countHit(db, limit, T0), { blocked: false, counted: true })
  assert.equal(await isBlocked(db, limit.key, T0), false)
  assert.deepEqual(await countHit(db, limit, T0), { blocked: true, counted: true })
  assert.equal(await isBlocked(db, limit.key, T0), true)
  assert.deepEqual(await countHit(db, limit, T0), { blocked: true, counted: false })
  assert.equal(await isBlocked(db, limit.key, after_(T0, 15 * 60 - 1)), true)
  assert.equal(await isBlocked(db, limit.key, after_(T0, 15 * 60 + 1)), false)
})

test('a window that has passed starts again from one', database, async () => {
  const limit = LIMITS.loginFailId(`${prefix}b`)
  for (let i = 0; i < 4; i++) await countHit(db, limit, T0)
  // The 5th failure comes after the window: it is the first of a new one.
  assert.deepEqual(await countHit(db, limit, after_(T0, 15 * 60 + 1)), { blocked: false, counted: true })
  const { rows } = await db.query('SELECT count FROM typle_auth_limits WHERE key = $1', [limit.key])
  assert.equal(rows[0].count, 1)
})

test('hits while blocked change nothing, and blockSeconds can outlast the window', database, async () => {
  const limit = { key: `limit:${prefix}c`, max: 2, windowSeconds: 60, blockSeconds: 600 }
  await countHit(db, limit, T0)
  assert.deepEqual(await countHit(db, limit, T0), { blocked: true, counted: true })
  // Still blocked after the window: the hit neither resets the count nor extends the block.
  assert.deepEqual(await countHit(db, limit, after_(T0, 120)), { blocked: true, counted: false })
  assert.equal(await isBlocked(db, limit.key, after_(T0, 599)), true)
  assert.equal(await isBlocked(db, limit.key, after_(T0, 601)), false)
})

test('concurrent hits are all counted', database, async () => {
  const limit = { key: `limit:${prefix}d`, max: 100, windowSeconds: 60 }
  await Promise.all(Array.from({ length: 20 }, () => countHit(db, limit, T0)))
  const { rows } = await db.query('SELECT count FROM typle_auth_limits WHERE key = $1', [limit.key])
  assert.equal(rows[0].count, 20)
})

test('clearHits forgets the failures', database, async () => {
  const limit = LIMITS.loginFailId(`${prefix}e`)
  for (let i = 0; i < 5; i++) await countHit(db, limit, T0)
  await clearHits(db, limit.key)
  assert.equal(await isBlocked(db, limit.key, T0), false)
  assert.deepEqual(await countHit(db, limit, T0), { blocked: false, counted: true })
})

const countOf = async key => (await db.query('SELECT count FROM typle_auth_limits WHERE key = $1', [key])).rows[0]?.count

test('undoHit takes back one hit, never below zero', database, async () => {
  const limit = { key: `limit:${prefix}f`, max: 5, windowSeconds: 60 }
  for (let i = 0; i < 2; i++) await countHit(db, limit, T0)
  await undoHit(db, limit.key, T0)
  assert.equal(await countOf(limit.key), 1)
  await undoHit(db, limit.key, T0)
  await undoHit(db, limit.key, T0)
  assert.equal(await countOf(limit.key), 0)
  await undoHit(db, `limit:${prefix}none`, T0)
  assert.equal(await countOf(`limit:${prefix}none`), undefined)
})

test('undoHit leaves a blocked key as it is', database, async () => {
  const limit = { key: `limit:${prefix}g`, max: 2, windowSeconds: 60 }
  for (let i = 0; i < 2; i++) await countHit(db, limit, T0)
  await undoHit(db, limit.key, T0)
  assert.equal(await countOf(limit.key), 2)
  assert.equal(await isBlocked(db, limit.key, T0), true)
})

test('the limits are the documented ones', () => {
  assert.deepEqual(LIMITS.loginFailId('a'), { key: 'login-fail:id:a', max: 5, windowSeconds: 900 })
  assert.deepEqual(LIMITS.loginFailIp('1.2.3.4'), { key: 'login-fail:ip:1.2.3.4', max: 30, windowSeconds: 900 })
  assert.deepEqual(LIMITS.signupIp('1.2.3.4'), { key: 'signup:ip:1.2.3.4', max: 5, windowSeconds: 3600 })
  assert.deepEqual(LIMITS.mailTarget('a@example.com'), { key: 'mail:target:a@example.com', max: 3, windowSeconds: 3600 })
  assert.deepEqual(LIMITS.mailIp('1.2.3.4'), { key: 'mail:ip:1.2.3.4', max: 10, windowSeconds: 3600 })
  assert.deepEqual(LIMITS.mailDaily('', '2026-11-20'), { key: 'mail:global:2026-11-20', max: 80, windowSeconds: 86400 })
  assert.deepEqual(LIMITS.mailDaily('e2e', '2026-11-20'), { key: 'mail:global:e2e:2026-11-20', max: 80, windowSeconds: 86400 })
})

test('the client IP is the first x-forwarded-for value', () => {
  const request = value => new Request('http://localhost/', value === undefined ? {} : { headers: { 'x-forwarded-for': value } })
  assert.equal(clientIp(request('1.2.3.4, 5.6.7.8')), '1.2.3.4')
  assert.equal(clientIp(request('  9.9.9.9  ')), '9.9.9.9')
  assert.equal(clientIp(request()), 'unknown')
  assert.equal(clientIp(request('')), 'unknown')
})

test('an IPv6 client is known by its /64, an IPv4 one by its address', () => {
  const request = value => new Request('http://localhost/', { headers: { 'x-forwarded-for': value } })
  assert.equal(clientIp(request('2001:db8:1:2:3:4:5:6')), '2001:db8:1:2::/64')
  assert.equal(clientIp(request('2001:DB8:0001:0002::9, 1.1.1.1')), '2001:db8:1:2::/64')
  assert.equal(clientIp(request('2001:db8::1')), '2001:db8:0:0::/64')
  assert.equal(clientIp(request('::1')), '0:0:0:0::/64')
  assert.equal(clientIp(request('fe80::1%en0')), 'fe80:0:0:0::/64')
  // An IPv4 address written as IPv6 is the IPv4 client.
  assert.equal(clientIp(request('::ffff:192.0.2.1')), '192.0.2.1')
  assert.equal(clientIp(request('192.0.2.1')), '192.0.2.1')
  // Anything else is kept as it is written.
  assert.equal(clientIp(request('not-an-ip')), 'not-an-ip')
})

test('pruneLimits deletes the rows whose window and block ended over a day ago', database, async () => {
  const now = new Date('2026-06-10T00:00:00Z')
  const rows = [
    [`prune:${prefix}old`, after_(now, -3 * 86400), null],
    [`prune:${prefix}oldblock`, after_(now, -3 * 86400), after_(now, -2 * 86400)],
    [`prune:${prefix}blocked`, after_(now, -3 * 86400), after_(now, -3600)],
    [`prune:${prefix}window`, after_(now, -86400), null],
  ]
  for (const [key, start, blocked] of rows) {
    await db.query('INSERT INTO typle_auth_limits (key, count, window_start, blocked_until) VALUES ($1, 1, $2, $3)', [key, start, blocked])
  }
  await pruneLimits(db, now)
  const { rows: left } = await db.query('SELECT key FROM typle_auth_limits WHERE key LIKE $1 ORDER BY key', [`prune:${prefix}%`])
  assert.deepEqual(left.map(row => row.key), [`prune:${prefix}blocked`, `prune:${prefix}window`])
})

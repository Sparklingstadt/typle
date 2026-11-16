require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { clientIp, retryAfter, countHit, overLimit } = require('../src/server/rateLimit.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

const request = headers => new Request('http://localhost/api/gallery/reports', { method: 'POST', headers })

// The cases of server/internal/web/ratelimit_test.go (TestClientIP), which the Go backend read on Vercel.
test('on Vercel the client is the first IP of the forwarding headers', () => {
  const cases = [
    [{ 'X-Vercel-Forwarded-For': '203.0.113.1, 198.51.100.1', 'X-Forwarded-For': '203.0.113.2', 'X-Real-Ip': '203.0.113.3' }, '203.0.113.1', true],
    [{ 'X-Forwarded-For': '  203.0.113.2 ,198.51.100.1', 'X-Real-Ip': '203.0.113.3' }, '203.0.113.2', true],
    [{ 'X-Real-Ip': ' 203.0.113.3 ' }, '203.0.113.3', true],
    [{ 'X-Forwarded-For': '2001:DB8::1' }, '2001:db8::1', true],
    [{ 'X-Vercel-Forwarded-For': 'not-an-ip', 'X-Forwarded-For': '', 'X-Real-Ip': '203.0.113.3' }, '203.0.113.3', true],
    [{ 'X-Forwarded-For': ' , 198.51.100.1', 'X-Real-Ip': '203.0.113.3' }, '203.0.113.3', true],
    [{}, 'unknown', false],
    [{ 'X-Forwarded-For': 'x', 'X-Real-Ip': 'y' }, 'unknown', false],
    [{ 'X-Forwarded-For': '::ffff:203.0.113.1' }, '203.0.113.1', true],
    [{ 'X-Forwarded-For': '2001:0db8:0000:0000:0000:0000:0000:0001' }, '2001:db8::1', true],
  ]
  for (const [headers, ip, known] of cases) assert.deepEqual(clientIp(request(headers), true), { ip, known }, JSON.stringify(headers))
})

// Anywhere else the client writes those headers itself, so they are not believed: every request is the one local client.
test('off Vercel every request is the one local client', () => {
  assert.deepEqual(clientIp(request({ 'X-Vercel-Forwarded-For': '203.0.113.1', 'X-Forwarded-For': '203.0.113.7' }), false), { ip: 'local', known: true })
  assert.deepEqual(clientIp(request({}), false), { ip: 'local', known: true })
})

// The cases of TestRetryAfter.
test('Retry-After is the whole seconds left in the window, at least 1', () => {
  const now = new Date('2026-11-02T12:00:30.500Z')
  const after = ms => new Date(now.getTime() + ms)
  assert.equal(retryAfter(after(29_500), now), 30)
  assert.equal(retryAfter(after(30_000), now), 30)
  assert.equal(retryAfter(after(200), now), 1)
  assert.equal(retryAfter(now, now), 1)
  assert.equal(retryAfter(after(-60_000), now), 1)
})

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const actions = []
after(async () => {
  if (!db) return
  await db.query('DELETE FROM typle_gallery_hits WHERE action = ANY($1)', [actions])
  await db.end()
})

test('the hits of a client are counted in windows of a minute', database, async () => {
  const action = `test-${randomUUID()}`
  actions.push(action)
  const client = Buffer.from(randomUUID().replace(/-/g, ''), 'hex')
  const counts = []
  if (60_000 - Date.now() % 60_000 < 3_000) await new Promise(resolve => setTimeout(resolve, 3_100))
  for (let i = 0; i < 3; i++) counts.push(await countHit(db, action, client))
  assert.deepEqual(counts.map(count => count.hits), [1, 2, 3])
  assert.equal(counts[0].windowEnd.getUTCSeconds(), 0)
  assert.equal(counts[0].windowEnd.getUTCMilliseconds(), 0)
  assert.ok(counts[0].windowEnd.getTime() > Date.now() - 1000)
})

test('over the limit the request is answered with 429 and Retry-After', database, async () => {
  const settings = { ...readLoginSettings({ AUTH_SECRET: 's', AUTH_URL: 'https://typle.example' }), onVercel: true }
  const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`
  const action = `test-${randomUUID()}`
  actions.push(action)
  const answers = []
  // All three must fall into one window of a minute.
  if (60_000 - Date.now() % 60_000 < 3_000) await new Promise(resolve => setTimeout(resolve, 3_100))
  for (let i = 0; i < 3; i++) answers.push(await overLimit(request({ 'X-Vercel-Forwarded-For': ip }), db, settings, action, 2))
  assert.equal(answers[0], null)
  assert.equal(answers[1], null)
  assert.equal(answers[2].status, 429)
  assert.equal(await answers[2].text(), '{"error":"tooManyRequests"}\n')
  const wait = Number(answers[2].headers.get('retry-after'))
  assert.ok(wait >= 1 && wait <= 60, String(wait))
  assert.equal(answers[2].headers.get('x-robots-tag'), 'noindex')
  assert.equal(answers[2].headers.get('cache-control'), 'no-store')
})

// A new window counts from 1 again, and windows older than ten minutes are forgotten when a hit is counted.
test('a new window counts again and old windows are forgotten', database, async () => {
  const action = `test-${randomUUID()}`
  actions.push(action)
  const client = Buffer.from(randomUUID().replace(/-/g, ''), 'hex')
  await db.query(`INSERT INTO typle_gallery_hits (action, client, window_start, hits) VALUES
    ($1, $2, date_trunc('minute', now()) - interval '1 minute', 99),
    ($1, $2, date_trunc('minute', now()) - interval '11 minutes', 99)`, [action, client])
  if (60_000 - Date.now() % 60_000 < 3_000) await new Promise(resolve => setTimeout(resolve, 3_100))
  assert.equal((await countHit(db, action, client)).hits, 1)
  const { rows } = await db.query(`SELECT now() - window_start > interval '10 minutes' AS old FROM typle_gallery_hits
    WHERE action = $1 AND client = $2 ORDER BY window_start`, [action, client])
  assert.deepEqual(rows.map(row => row.old), [false, false])
})

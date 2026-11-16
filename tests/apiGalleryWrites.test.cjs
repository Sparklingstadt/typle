require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { answerGalleryAdded, answerGalleryReport } = require('../src/server/galleryWrites.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`. The shares are made under
// one random owner, and every test counts as its own client (a random IP on Vercel), so the counts of others do not mix in.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const owner = `test-gallery-writes-${randomUUID()}`
const db = url ? createPool(url) : null
const origin = 'https://typle.example'
const settings = { ...readLoginSettings({ AUTH_SECRET: 'typle-test-secret', AUTH_URL: origin }), onVercel: true }
after(async () => {
  if (!db) return
  await db.query('DELETE FROM typle_shared_packs WHERE owner_id = $1', [owner])
  await db.end()
})

const randomIp = () => `2001:db8::${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}`

async function insertShare({ listed = new Date(), hidden = null } = {}) {
  const id = randomUUID()
  await db.query(`INSERT INTO typle_shared_packs (id, owner_id, pack_id, data, listed_at, hidden_at)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
  [id, owner, `p-${id}`, JSON.stringify({ format: 'typle-pack', version: 1, pack: { name: 'n' }, lists: [] }), listed, hidden])
  return id
}

const addCount = async id => (await db.query('SELECT add_count FROM typle_shared_packs WHERE id = $1', [id])).rows[0].add_count
const reports = async id => (await db.query('SELECT reason FROM typle_gallery_reports WHERE share_id = $1', [id])).rows.map(row => row.reason)

function added(id, { ip, headers = {} } = {}) {
  return new Request(`http://localhost/api/gallery/added?id=${id}`, {
    method: 'POST', headers: { Origin: origin, 'X-Vercel-Forwarded-For': ip ?? randomIp(), ...headers },
  })
}

function report(body, { ip, headers = {} } = {}) {
  return new Request('http://localhost/api/gallery/reports', {
    method: 'POST', body,
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Vercel-Forwarded-For': ip ?? randomIp(), ...headers },
  })
}

async function expectAnswer(response, status, body) {
  assert.equal(response.status, status)
  assert.equal(await response.text(), body)
  assert.equal(response.headers.get('x-robots-tag'), 'noindex')
  assert.equal(response.headers.get('cache-control'), 'no-store')
}

const open = () => db

// The limit counts in windows of a whole minute: a test that counts many requests starts away from a window's end, so
// that its requests all fall into one window.
async function awayFromMinuteEnd() {
  const left = 60_000 - Date.now() % 60_000
  if (left < 3_000) await new Promise(resolve => setTimeout(resolve, left + 100))
}
const withSettings = () => settings

test('an add of a listed pack is counted', database, async () => {
  const id = await insertShare()
  await expectAnswer(await answerGalleryAdded(added(id), open, withSettings), 204, '')
  assert.equal(await addCount(id), 1)
})

test('an add of a pack that is not in the gallery is answered the same and not counted', database, async () => {
  const unlisted = await insertShare({ listed: null })
  const hidden = await insertShare({ hidden: new Date() })
  for (const id of [unlisted, hidden, randomUUID(), 'not-a-uuid', '']) {
    await expectAnswer(await answerGalleryAdded(added(id), open, withSettings), 204, '')
  }
  assert.equal(await addCount(unlisted), 0)
  assert.equal(await addCount(hidden), 0)
})

test('the 61st add of a client in a minute is refused', database, async () => {
  const id = await insertShare()
  const ip = randomIp()
  await awayFromMinuteEnd()
  for (let i = 0; i < 60; i++) assert.equal((await answerGalleryAdded(added(id, { ip }), open, withSettings)).status, 204, `add ${i + 1}`)
  const refused = await answerGalleryAdded(added(id, { ip }), open, withSettings)
  await expectAnswer(refused, 429, '{"error":"tooManyRequests"}\n')
  assert.ok(Number(refused.headers.get('retry-after')) >= 1)
  assert.equal(await addCount(id), 60)
})

test('an add must come from the app', database, async () => {
  const id = await insertShare()
  await expectAnswer(await answerGalleryAdded(added(id, { headers: { Origin: 'https://evil.example' } }), open, withSettings), 403, '{"error":"forbiddenRequest"}\n')
  const noOrigin = new Request(`http://localhost/api/gallery/added?id=${id}`, { method: 'POST', headers: { 'X-Vercel-Forwarded-For': randomIp() } })
  await expectAnswer(await answerGalleryAdded(noOrigin, open, withSettings), 403, '{"error":"forbiddenRequest"}\n')
  const app = new Request(`http://localhost/api/gallery/added?id=${id}`, { method: 'POST', headers: { Authorization: 'Bearer x', 'X-Vercel-Forwarded-For': randomIp() } })
  await expectAnswer(await answerGalleryAdded(app, open, withSettings), 204, '')
  assert.equal(await addCount(id), 1)
})

test('a report of a listed pack is recorded', database, async () => {
  const id = await insertShare()
  await expectAnswer(await answerGalleryReport(report(JSON.stringify({ id, reason: 'spam' })), open, withSettings), 204, '')
  assert.deepEqual(await reports(id), ['spam'])
})

test('a report that is not one is refused', database, async () => {
  const id = await insertShare()
  for (const body of [`{"id":"${id}","reason":"bad"}`, `{"id":"${id}"}`, '{"reason":"spam"}', '{"id":"","reason":"spam"}',
    `{"id":"${id}","reason":null}`, `{"id":"${id}","reason":"spam","x":1}`, '[]', 'x', '{"id":1,"reason":"spam"}']) {
    await expectAnswer(await answerGalleryReport(report(body), open, withSettings), 400, '{"error":"invalidReport"}\n')
  }
  const good = JSON.stringify({ id, reason: 'spam' })
  for (const headers of [{ Origin: 'https://evil.example' }, { 'Content-Type': 'text/plain' }]) {
    await expectAnswer(await answerGalleryReport(report(good, { headers }), open, withSettings), 403, '{"error":"forbiddenRequest"}\n')
  }
  assert.deepEqual(await reports(id), [])
})

test('a report of a pack that is not in the gallery is not found', database, async () => {
  for (const id of [await insertShare({ listed: null }), await insertShare({ hidden: new Date() }), randomUUID(), 'not-a-uuid']) {
    await expectAnswer(await answerGalleryReport(report(JSON.stringify({ id, reason: 'other' })), open, withSettings), 404, '{"error":"notInGallery"}\n')
  }
})

test('the 11th report of a client in a minute is refused', database, async () => {
  const id = await insertShare()
  const ip = randomIp()
  await awayFromMinuteEnd()
  const body = JSON.stringify({ id, reason: 'spam' })
  for (let i = 0; i < 10; i++) assert.equal((await answerGalleryReport(report(body, { ip }), open, withSettings)).status, 204, `report ${i + 1}`)
  await expectAnswer(await answerGalleryReport(report(body, { ip }), open, withSettings), 429, '{"error":"tooManyRequests"}\n')
  assert.equal((await reports(id)).length, 10)
})

test('503 without the login settings, or with the database down', async () => {
  const id = randomUUID()
  const original = console.error
  console.error = () => {}
  const down = createPool('postgres://user:pass@127.0.0.1:1/none')
  try {
    for (const answer of [answerGalleryAdded, answerGalleryReport]) {
      const make = () => answer === answerGalleryAdded ? added(id) : report(JSON.stringify({ id, reason: 'spam' }))
      await expectAnswer(await answer(make(), () => { throw new Error('not opened') }, () => null), 503, '{"error":"authUnavailable"}\n')
      await expectAnswer(await answer(make(), () => down, withSettings), 503, '{"error":"databaseUnavailable"}\n')
    }
  } finally {
    console.error = original
    await down.end()
  }
})

test('the routes answer other methods with 405', async () => {
  for (const route of [require('../src/app/api/gallery/added/route.ts'), require('../src/app/api/gallery/reports/route.ts')]) {
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await route[method]()
      assert.equal(response.status, 405, method)
      assert.equal(response.headers.get('allow'), 'POST', method)
      assert.equal(response.headers.get('x-robots-tag'), 'noindex', method)
    }
  }
})

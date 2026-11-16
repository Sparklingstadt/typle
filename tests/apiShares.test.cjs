require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac, hkdfSync, randomInt } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { answerShares, sharedPackFile } = require('../src/server/shares.ts')
const { readSharedPack } = require('../src/server/shared.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`. Each test signs in as an
// account of its own, whose rows are deleted at the end.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const secret = 'typle-shares-test-secret'
const origin = 'http://127.0.0.1:3101'
const settings = readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: origin })
const withSettings = () => settings
const open = () => db
const owners = []
after(async () => {
  if (!db) return
  await db.query('DELETE FROM typle_shared_packs WHERE owner_id = ANY($1)', [owners])
  await db.query('DELETE FROM typle_workspaces WHERE owner_id = ANY($1)', [owners])
  await db.end()
})

function seal(info, sub) {
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32))
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ sub, name: 'N', image: '', iat: now - 60, exp: now + 3600 })).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}

const at = '2026-10-01T00:00:00.000Z'
/** An account with a saved workspace of one pack, pack-a, and its login cookie. */
async function account() {
  const owner = `github:${randomInt(1e9, 2e9)}`
  owners.push(owner)
  const packs = [{ id: 'pack-a', name: '動物', createdAt: at }]
  const lists = [{ id: 'l1', name: '動物', packId: 'pack-a', words: [{ display: 'Cat', input: 'cat', annotation: '' }], records: [], createdAt: at }]
  await db.query(`INSERT INTO typle_workspaces (owner_id, lists, packs, devices) VALUES ($1, $2::jsonb, $3::jsonb, '[]'::jsonb)`,
    [owner, JSON.stringify(lists), JSON.stringify(packs)])
  return { owner, cookie: `typle-session=${seal('typle session v1', owner)}`, token: seal('typle app session v1', owner) }
}

const browser = (user, method, { body, path = '/api/shares', headers = {} } = {}) => new Request(`${origin}${path}`, {
  method, body,
  headers: { Cookie: user.cookie, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
})
const share = (user, body, options) => answerShares(browser(user, 'PUT', { body: JSON.stringify(body), ...options }), open, withSettings)

async function expectError(response, status, key) {
  assert.equal(response.status, status)
  assert.equal(await response.text(), `{"error":"${key}"}\n`)
}

test('a pack is shared, listed by its owner and readable by link', database, async () => {
  const user = await account()
  const response = await share(user, { packId: 'pack-a' })
  assert.equal(response.status, 200)
  const shared = JSON.parse(await response.text())
  assert.deepEqual(Object.keys(shared), ['id', 'packId', 'name', 'updatedAt', 'listed', 'hidden'])
  assert.deepEqual({ ...shared, id: undefined, updatedAt: undefined }, { id: undefined, packId: 'pack-a', name: '動物', updatedAt: undefined, listed: false, hidden: false })
  assert.match(shared.updatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)

  const list = await answerShares(browser(user, 'GET'), open, withSettings)
  assert.equal(list.status, 200)
  assert.deepEqual(JSON.parse(await list.text()).shares.map(item => item.id), [shared.id])

  const { rows } = await db.query('SELECT lists::text AS lists, packs::text AS packs, devices::text AS devices FROM typle_workspaces WHERE owner_id = $1', [user.owner])
  assert.equal(await readSharedPack(db, shared.id), sharedPackFile(rows[0], 'pack-a'))

  // Sharing again keeps the link.
  const again = JSON.parse(await (await share(user, { packId: 'pack-a' })).text())
  assert.equal(again.id, shared.id)
})

test('a pack is put in the gallery and taken out', database, async () => {
  const user = await account()
  const listed = JSON.parse(await (await share(user, { packId: 'pack-a', listed: true })).text())
  assert.equal(listed.listed, true)
  const listedAt = async () => (await db.query('SELECT listed_at FROM typle_shared_packs WHERE id = $1', [listed.id])).rows[0].listed_at
  const first = await listedAt()
  await share(user, { packId: 'pack-a', listed: true })
  assert.equal((await listedAt()).getTime(), first.getTime())
  assert.equal(JSON.parse(await (await share(user, { packId: 'pack-a', listed: false })).text()).listed, false)
  assert.equal(await listedAt(), null)
})

test('a hidden link keeps being copied but its listing cannot change', database, async () => {
  const user = await account()
  const { id } = JSON.parse(await (await share(user, { packId: 'pack-a', listed: true })).text())
  await db.query('UPDATE typle_shared_packs SET hidden_at = now() WHERE id = $1', [id])
  await expectError(await share(user, { packId: 'pack-a', listed: false }), 409, 'sharedPackHidden')
  const copied = await share(user, { packId: 'pack-a' })
  assert.equal(copied.status, 200)
  assert.equal(JSON.parse(await copied.text()).hidden, true)
})

test('a pack that is not there, or a bad body, is refused', database, async () => {
  const user = await account()
  await expectError(await share(user, { packId: 'nope' }), 404, 'packNotFound')
  for (const body of ['{}', '{"packId":""}', '{"packId":"pack-a","listed":null}', '{"packId":"pack-a","x":1}', '[]', 'x', '{"packId":1}']) {
    await expectError(await answerShares(browser(user, 'PUT', { body }), open, withSettings), 400, 'invalidWorkspace')
  }
})

test('a write must come from the app', database, async () => {
  const user = await account()
  const body = JSON.stringify({ packId: 'pack-a' })
  await expectError(await answerShares(browser(user, 'PUT', { body, headers: { Origin: 'https://evil.example' } }), open, withSettings), 403, 'forbiddenRequest')
  await expectError(await answerShares(browser(user, 'PUT', { body, headers: { 'Content-Type': 'text/plain' } }), open, withSettings), 403, 'forbiddenRequest')
  await expectError(await answerShares(browser(user, 'DELETE', { path: '/api/shares?pack=pack-a', headers: { Origin: '' } }), open, withSettings), 403, 'forbiddenRequest')
  const app = new Request(`${origin}/api/shares`, { method: 'PUT', body, headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' } })
  assert.equal((await answerShares(app, open, withSettings)).status, 200)
})

test('without a login every method is refused', database, async () => {
  const anonymous = { cookie: '' }
  await expectError(await answerShares(browser(anonymous, 'GET'), open, withSettings), 401, 'loginRequired')
  await expectError(await answerShares(browser(anonymous, 'PUT', { body: '{"packId":"pack-a"}' }), open, withSettings), 401, 'loginRequired')
  await expectError(await answerShares(browser(anonymous, 'DELETE', { path: '/api/shares?pack=pack-a' }), open, withSettings), 401, 'loginRequired')
})

test('a share is stopped, and stopping one that is not shared is answered the same', database, async () => {
  const user = await account()
  await share(user, { packId: 'pack-a' })
  for (let i = 0; i < 2; i++) {
    const stopped = await answerShares(browser(user, 'DELETE', { path: '/api/shares?pack=pack-a' }), open, withSettings)
    assert.equal(stopped.status, 204)
    assert.equal(await stopped.text(), '')
    assert.equal(stopped.headers.get('cache-control'), 'private, no-store')
    assert.equal(stopped.headers.get('vary'), 'Cookie')
  }
  assert.deepEqual(JSON.parse(await (await answerShares(browser(user, 'GET'), open, withSettings)).text()), { shares: [] })
  await expectError(await answerShares(browser(user, 'DELETE'), open, withSettings), 400, 'invalidWorkspace')
})

test('503 without the login settings, or with the database down', database, async () => {
  const user = await account()
  await expectError(await answerShares(browser(user, 'GET'), () => { throw new Error('not opened') }, () => null), 503, 'authUnavailable')
  const down = createPool('postgres://user:pass@127.0.0.1:1/none')
  const original = console.error
  console.error = () => {}
  try {
    await expectError(await answerShares(browser(user, 'GET'), () => down, withSettings), 503, 'databaseUnavailable')
    await expectError(await answerShares(browser(user, 'PUT', { body: '{"packId":"pack-a"}' }), () => down, withSettings), 503, 'databaseUnavailable')
  } finally {
    console.error = original
    await down.end()
  }
})

test('the route answers other methods with 405', async () => {
  const route = require('../src/app/api/shares/route.ts')
  for (const method of ['POST', 'PATCH', 'OPTIONS']) {
    const response = await route[method]()
    assert.equal(response.status, 405, method)
    assert.equal(response.headers.get('allow'), 'GET, HEAD, PUT, DELETE', method)
  }
})

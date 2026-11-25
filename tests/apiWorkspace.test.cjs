require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac, hkdfSync, randomInt } = require('node:crypto')
const { createPool, createPrisma } = require('../src/server/database.ts')
const { answerWorkspace } = require('../src/server/workspace.ts')
const { readLoginSettings } = require('../src/server/settings.ts')
const { DEFAULT_INTERESTS } = require('../src/lib/interests.ts')

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
// The code under test gets Prisma Client; the tests set up and look at the tables with SQL, as the fixtures were made.
const sql = url ? createPool(url) : null
const db = url ? createPrisma(url) : null
const secret = 'typle-workspace-test-secret'
const origin = 'http://127.0.0.1:3101'
const settings = readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: origin })
const withSettings = () => settings
const open = () => db
const owners = []
after(async () => {
  if (!db) return
  for (const table of ['typle_session_revocations', 'typle_records', 'typle_workspaces']) {
    await sql.query(`DELETE FROM ${table} WHERE owner_id = ANY($1)`, [owners])
  }
  await sql.end()
  await db.$disconnect()
})

function seal(info, sub) {
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32))
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ sub, name: 'N', image: '', iat: now - 60, exp: now + 3600 })).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}
function account() {
  const owner = `github:${randomInt(1e9, 2e9)}`
  owners.push(owner)
  return { owner, cookie: `typle-session=${seal('typle session v1', owner)}`, token: seal('typle app session v1', owner) }
}

const at = '2026-09-07T00:00:00.000Z'
const library = name => ({ packs: [{ id: 'p', name: 'P', createdAt: at }],
  lists: [{ id: 'l', name, packId: 'p', words: [{ display: 'a', input: 'a', annotation: '' }], records: [], createdAt: at }] })
const get = user => new Request(`${origin}/api/workspace`, { headers: { Cookie: user.cookie } })
const put = (user, body, headers = {}) => new Request(`${origin}/api/workspace`, {
  method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { Cookie: user.cookie, Origin: origin, 'Content-Type': 'application/json', ...headers },
})
async function expectError(response, status, key) {
  assert.equal(response.status, status)
  assert.equal(await response.text(), `{"error":"${key}"}\n`)
}

test('an account that has saved nothing reads as revision 0', database, async () => {
  const user = account()
  const response = await answerWorkspace(get(user), open, withSettings)
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(await response.text()), { lists: [], packs: null, devices: [], interests: [...DEFAULT_INTERESTS], revision: 0, accountId: user.owner })
})

test('a save is answered with the workspace as saved, and read back', database, async () => {
  const user = account()
  const saved = await answerWorkspace(put(user, { revision: 0, accountId: user.owner, ...library('one') }), open, withSettings)
  assert.equal(saved.status, 200)
  const answer = JSON.parse(await saved.text())
  assert.equal(answer.revision, 1)
  assert.equal(answer.lists[0].name, 'one')
  assert.deepEqual(JSON.parse(await (await answerWorkspace(get(user), open, withSettings)).text()), answer)
  // A stale revision is told that the workspace moved on.
  await expectError(await answerWorkspace(put(user, { revision: 0, accountId: user.owner, ...library('two') }), open, withSettings), 409, 'conflict')
})

test('a save is refused as the Go backend refused it', database, async () => {
  const user = account()
  const good = { revision: 0, accountId: user.owner, ...library('one') }
  await expectError(await answerWorkspace(put(user, good, { Origin: 'https://evil.example' }), open, withSettings), 403, 'forbiddenRequest')
  await expectError(await answerWorkspace(put(user, good, { 'Content-Type': 'text/plain' }), open, withSettings), 403, 'forbiddenRequest')
  await expectError(await answerWorkspace(put({ cookie: '' }, good), open, withSettings), 401, 'loginRequired')
  await expectError(await answerWorkspace(put(user, ''), open, withSettings), 400, 'emptyRequest')
  await expectError(await answerWorkspace(put(user, `{"x":"${'a'.repeat(1 << 20)}"}`), open, withSettings), 413, 'workspaceTooLarge')
  await expectError(await answerWorkspace(put(user, '[]'), open, withSettings), 400, 'invalidWorkspace')
  await expectError(await answerWorkspace(put(user, { ...good, accountId: 'github:2' }), open, withSettings), 401, 'loginAccountChanged')
  await expectError(await answerWorkspace(put(user, { ...good, lists: null }), open, withSettings), 400, 'invalidWorkspace')
  await expectError(await answerWorkspace(put(user, good), () => { throw new Error('not opened') }, () => null), 503, 'authUnavailable')
})

test('a revoked login can neither read nor save, and a browser loses its cookie', database, async () => {
  const user = account()
  await sql.query('INSERT INTO typle_session_revocations (owner_id, revoked_at) VALUES ($1, now())', [user.owner])
  for (const request of [get(user), put(user, { revision: 0, accountId: user.owner, ...library('one') })]) {
    const response = await answerWorkspace(request, open, withSettings)
    await expectError(response, 401, 'loginRequired')
    assert.equal(response.headers.get('set-cookie'), 'typle-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
  }
})

test('the route answers other methods with 405', async () => {
  const route = require('../src/app/api/workspace/route.ts')
  for (const method of ['POST', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await route[method]()
    assert.equal(response.status, 405, method)
    assert.equal(response.headers.get('allow'), 'GET, HEAD, PUT', method)
  }
})

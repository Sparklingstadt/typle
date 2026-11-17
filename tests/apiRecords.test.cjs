require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac, hkdfSync, randomInt } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { answerRecords } = require('../src/server/workspace.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

// The scenarios were run by the Go backend against a real database (tests/fixtures/record-writes.json): each request here
// must answer as it did and leave the same row, records and links.
const { scenarios } = require('./fixtures/record-writes.json')

const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const secret = 'typle-records-test-secret'
const origin = 'http://127.0.0.1:3101'
const settings = readLoginSettings({ AUTH_SECRET: secret, AUTH_URL: origin })
const withSettings = () => settings
const open = () => db
const owners = []
after(async () => {
  if (!db) return
  for (const table of ['typle_session_revocations', 'typle_records', 'typle_workspaces']) {
    await db.query(`DELETE FROM ${table} WHERE owner_id = ANY($1)`, [owners])
  }
  await db.end()
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
const request = (user, method, body, headers = {}) => new Request(`${origin}/api/workspace/records`, {
  method, body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { Cookie: user.cookie, Origin: origin, 'Content-Type': 'application/json', ...headers },
})

async function state(owner) {
  const row = (await db.query(`SELECT COALESCE((SELECT jsonb_build_object('lists', lists, 'packs', packs, 'devices', devices, 'interests', interests,
    'revision', revision, 'split', records_split) FROM typle_workspaces WHERE owner_id = $1), 'null'::jsonb)::text AS v`, [owner])).rows[0].v
  const records = (await db.query(`SELECT COALESCE(jsonb_agg(jsonb_build_array(list_id, record_id, position, (extract(epoch FROM at) * 1000)::bigint, data)
    ORDER BY list_id, position), '[]'::jsonb)::text AS v FROM typle_records WHERE owner_id = $1`, [owner])).rows[0].v
  return { row: JSON.parse(row), records: JSON.parse(records) }
}

for (const scenario of scenarios) {
  test(`as the Go backend: ${scenario.name}`, database, async () => {
    const user = account()
    const row = scenario.setup.row
    if (row) {
      await db.query(`INSERT INTO typle_workspaces (owner_id, lists, packs, devices, interests, revision, records_split)
        VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)`,
      [user.owner, JSON.stringify(row.lists), row.packs === null ? null : JSON.stringify(row.packs), JSON.stringify(row.devices),
        row.interests === null ? null : JSON.stringify(row.interests), row.revision, row.split])
    }
    const original = console.error
    console.error = () => {}
    try {
      for (const [index, step] of scenario.steps.entries()) {
        const response = await answerRecords(request(user, step.kind === 'add' ? 'POST' : 'DELETE', { accountId: user.owner, ...step.body }), open, withSettings)
        const answer = JSON.parse(await response.text())
        assert.equal(response.status, step.status, `step ${index + 1}`)
        if (step.key) assert.deepEqual(answer, { error: step.key }, `step ${index + 1}`)
        if (step.kind === 'add' && !step.key) assert.deepEqual(answer.record, step.record, `step ${index + 1}`)
        assert.deepEqual(await state(user.owner), { row: step.row, records: step.records }, `step ${index + 1}`)
      }
    } finally {
      console.error = original
    }
  })
}

const at = '2026-09-07T00:00:00.000Z'
async function withRow(user) {
  const lists = [{ id: 'l1', name: 'l1', packId: 'p', words: [{ display: 'a', input: 'a', annotation: '' }], records: [], createdAt: at }]
  await db.query(`INSERT INTO typle_workspaces (owner_id, lists, packs, devices, revision, records_split) VALUES ($1, $2::jsonb, $3::jsonb, '[]'::jsonb, 1, true)`,
    [user.owner, JSON.stringify(lists), JSON.stringify([{ id: 'p', name: 'P', createdAt: at }])])
}
const run = { id: 'run-1', time: 2.5, date: '2026-10-02T10:00:00.000Z', mistakes: 0, accuracy: 100, wordCount: 1 }
async function expectError(response, status, key) {
  assert.equal(response.status, status)
  assert.equal(await response.text(), `{"error":"${key}"}\n`)
}

test('a request is refused as the Go backend refused it', database, async () => {
  const user = account()
  await withRow(user)
  const good = { accountId: user.owner, listId: 'l1', record: run }
  await expectError(await answerRecords(request(user, 'POST', good, { Origin: 'https://evil.example' }), open, withSettings), 403, 'forbiddenRequest')
  await expectError(await answerRecords(request(user, 'POST', good, { 'Content-Type': 'text/plain' }), open, withSettings), 403, 'forbiddenRequest')
  await expectError(await answerRecords(request({ cookie: '' }, 'POST', good), open, withSettings), 401, 'loginRequired')
  await expectError(await answerRecords(request(user, 'POST', ''), open, withSettings), 400, 'emptyRequest')
  await expectError(await answerRecords(request(user, 'POST', `{"x":"${'a'.repeat(1 << 20)}"}`), open, withSettings), 413, 'workspaceTooLarge')
  await expectError(await answerRecords(request(user, 'POST', '[]'), open, withSettings), 400, 'invalidRecord')
  await expectError(await answerRecords(request(user, 'POST', { ...good, accountId: 'github:2' }), open, withSettings), 401, 'loginAccountChanged')
  await expectError(await answerRecords(request(user, 'DELETE', { accountId: user.owner, listId: 'l1' }), open, withSettings), 400, 'invalidRecord')
  await expectError(await answerRecords(request(user, 'POST', good), () => { throw new Error('not opened') }, () => null), 503, 'authUnavailable')
})

test('an app adds a record with its token and without an Origin', database, async () => {
  const user = account()
  await withRow(user)
  const response = await answerRecords(new Request(`${origin}/api/workspace/records`, { method: 'POST',
    body: JSON.stringify({ accountId: user.owner, listId: 'l1', record: run }),
    headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' } }), open, withSettings)
  assert.equal(response.status, 201)
})

test('a revoked login is refused, and a browser loses its cookie', database, async () => {
  const user = account()
  await withRow(user)
  await db.query('INSERT INTO typle_session_revocations (owner_id, revoked_at) VALUES ($1, now())', [user.owner])
  const response = await answerRecords(request(user, 'POST', { accountId: user.owner, listId: 'l1', record: run }), open, withSettings)
  await expectError(response, 401, 'loginRequired')
  assert.equal(response.headers.get('set-cookie'), 'typle-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
})

test('a record added and deleted is measured when TYPLE_MEASURE_SAVES is 1', database, async () => {
  const user = account()
  await withRow(user)
  const latest = async () => (await db.query(`SELECT id, operation, status FROM typle_save_metrics ORDER BY id DESC LIMIT 1`)).rows[0]
  const env = { TYPLE_MEASURE_SAVES: '1' }
  await answerRecords(request(user, 'POST', { accountId: user.owner, listId: 'l1', record: run }), open, withSettings, env)
  const added = await latest()
  await answerRecords(request(user, 'DELETE', { accountId: user.owner, listId: 'l1', recordId: 'run-1' }), open, withSettings, env)
  const deleted = await latest()
  try {
    assert.deepEqual([added.operation, added.status], ['record.add', 201])
    assert.deepEqual([deleted.operation, deleted.status], ['record.delete', 200])
  } finally {
    await db.query('DELETE FROM typle_save_metrics WHERE id = ANY($1)', [[added.id, deleted.id]])
  }
})

test('the route answers other methods with 405', async () => {
  const route = require('../src/app/api/workspace/records/route.ts')
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'OPTIONS']) {
    const response = await route[method]()
    assert.equal(response.status, 405, method)
    assert.equal(response.headers.get('allow'), 'POST, DELETE', method)
  }
})

// docs/api/workspace-records.openapi.json is the contract of /api/workspace/records, which the app and the iPad and Mac
// apps read: every answer here is one it declares, and every one it declares is answered to some request. (The Go
// backend's TestRecordsContract held its handler to it until v2.46.6.)
test('every answer is one the contract declares, and every declared one is answered', database, async () => {
  const contract = require('../docs/api/workspace-records.openapi.json')
  const declared = {}
  for (const [method, operation] of Object.entries(contract.paths['/api/workspace/records'])) {
    declared[method.toUpperCase()] = Object.fromEntries(Object.entries(operation.responses)
      .map(([status, response]) => [status, response.content?.['application/json']?.schema?.properties?.error?.enum ?? ['']]))
  }
  const { MAX_RECORDS } = require('../src/lib/records.ts')
  const user = account()
  const full = Array.from({ length: MAX_RECORDS }, (_, n) => ({ id: `r${n}`, time: 1, date: '2026-10-01T00:00:00.000Z' }))
  const lists = ['one', 'full'].map(id => ({ id, name: id, packId: 'p', words: [{ display: 'a', input: 'a', annotation: '' }], records: id === 'full' ? full : [], createdAt: at }))
  await db.query(`INSERT INTO typle_workspaces (owner_id, lists, packs, devices, revision, records_split) VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, 1, false)`,
    [user.owner, JSON.stringify(lists), JSON.stringify([{ id: 'p', name: 'P', createdAt: at }]), JSON.stringify([{ id: 'mac', name: 'Mac', layout: 'JIS' }])])
  const aRun = { id: 'run-1', time: 2.5, date: '2026-10-02T10:00:00.000Z', mistakes: 1, accuracy: 95.5, wordCount: 1, deviceId: 'mac' }
  const body = (listId, record, owner = user.owner) => ({ accountId: owner, listId, record })
  const del = (listId, recordId, owner = user.owner) => ({ accountId: owner, listId, recordId })
  const tooLarge = JSON.stringify({ ...body('one', aRun), pad: 'x'.repeat(1 << 20) })
  // A database that answers the login's questions but cannot hold the workspace, and one that cannot answer at all.
  const writeDown = () => ({ query: (...args) => db.query(...args), connect: () => Promise.reject(new Error('down')) })
  const allDown = () => ({ query: () => Promise.reject(new Error('down')), connect: () => Promise.reject(new Error('down')) })
  const anonymous = { cookie: '' }
  const calls = [
    ['POST', body('one', aRun)], ['POST', body('one', aRun)], ['POST', ''],
    ['POST', body('one', { ...aRun, accuracy: 101 })],
    // A new id: a saved one is answered as sent again before its device is looked at.
    ['POST', body('one', { ...aRun, id: 'run-2', deviceId: 'gone' })],
    ['POST', body('full', { ...aRun, id: 'new' })], ['POST', body('gone', aRun)],
    ['POST', body('one', aRun), { user: anonymous }], ['POST', body('one', aRun, 'github:1')],
    ['POST', body('one', aRun), { headers: { Origin: 'https://evil.example' } }], ['POST', tooLarge],
    ['POST', body('one', aRun), { open: writeDown }], ['POST', body('one', aRun), { open: allDown }],
    ['DELETE', del('one', 'run-1')], ['DELETE', ''], ['DELETE', { accountId: user.owner, listId: 'one' }],
    ['DELETE', del('one', 'run-1'), { user: anonymous }], ['DELETE', del('one', 'run-1', 'github:1')],
    ['DELETE', del('one', 'run-1'), { headers: { Origin: 'https://evil.example' } }], ['DELETE', tooLarge],
    ['DELETE', del('one', 'run-1'), { open: writeDown }], ['DELETE', del('one', 'run-1'), { open: allDown }],
  ]
  const seen = new Set()
  const original = console.error
  console.error = () => {}
  try {
    for (const [index, [method, sent, options = {}]] of calls.entries()) {
      const response = await answerRecords(request(options.user ?? user, method, sent, options.headers), options.open ?? open, withSettings)
      const key = response.status >= 400 ? JSON.parse(await response.text()).error : ''
      assert.ok(declared[method][String(response.status)]?.includes(key), `call ${index} (${method}): ${response.status} ${key} is not declared`)
      seen.add(`${method} ${response.status} ${key}`)
    }
    // 405 is answered to any other method; it is declared under each method the path has.
    const route = require('../src/app/api/workspace/records/route.ts')
    const notAllowed = await route.GET()
    assert.ok(declared.POST['405']?.includes(JSON.parse(await notAllowed.text()).error))
    seen.add('POST 405 methodNotAllowed')
  } finally {
    console.error = original
  }
  for (const [method, statuses] of Object.entries(declared)) {
    for (const [status, keys] of Object.entries(statuses)) {
      for (const key of keys) {
        if (method === 'DELETE' && status === '405') continue // The same answer as POST's 405, for the same requests.
        assert.ok(seen.has(`${method} ${status} ${key}`), `${method} ${status} ${key} is declared but never answered`)
      }
    }
  }
})

// Every field the contract declares for a record is one a POST may send, and no other is taken. (The Go backend's
// TestRecordInputContract.)
test('a record may have the fields the contract declares, and no other', () => {
  const contract = require('../docs/api/workspace-records.openapi.json')
  const { readRecordAdd } = require('../src/server/workspace.ts')
  const declared = Object.keys(contract.components.schemas.RecordInput.properties)
  for (const name of declared) {
    assert.ok(readRecordAdd({ accountId: 'a', listId: 'l', record: { id: 'r', [name]: name === 'id' ? 'r' : 1 } }), name)
  }
  assert.equal(readRecordAdd({ accountId: 'a', listId: 'l', record: { id: 'r', notDeclared: 1 } }), null)
  assert.ok(declared.includes('id') && declared.includes('missed'))
})

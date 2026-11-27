require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomInt } = require('node:crypto')
const { createPool, createPrisma } = require('../src/server/database.ts')
const { readWorkspace, writeWorkspace, Conflict } = require('../src/server/workspace.ts')
const { answerDemoReset, resetDemoWorkspace } = require('../src/server/demoReset.ts')
const { demoWorkspace } = require('../src/server/demoWorkspace.ts')

// Putting the shared demo account back to its sample (src/server/demoReset.ts), against a real database, under owners
// of their own so that the demo account's own data is left alone.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const sql = url ? createPool(url) : null
const db = url ? createPrisma(url) : null
const owners = []
after(async () => {
  if (!db) return
  for (const table of ['typle_records', 'typle_workspaces']) await sql.query(`DELETE FROM ${table} WHERE owner_id = ANY($1)`, [owners])
  await sql.end()
  await db.$disconnect()
})
const newOwner = () => {
  const owner = `github:${randomInt(1e9, 2e9)}`
  owners.push(owner)
  return owner
}
const now = new Date()
const sampleNames = () => demoWorkspace(now).lists.map(list => list.name).sort()
const recordCount = (saved) => saved.lists.reduce((sum, list) => sum + (list.records?.length ?? 0), 0)

test('a reset with nothing saved puts the sample in', database, async () => {
  const owner = newOwner()
  const saved = await resetDemoWorkspace(db, now, owner)
  assert.deepEqual(saved.lists.map(list => list.name).sort(), sampleNames())
  assert.equal(recordCount(saved), recordCount(demoWorkspace(now)))
})

test('a reset puts back what a visitor changed, with a higher revision, and an older save then conflicts', database, async () => {
  const owner = newOwner()
  const first = await resetDemoWorkspace(db, now, owner)
  const changed = await writeWorkspace(db, owner, first.revision, { lists: first.lists.slice(1), packs: first.packs })
  const reset = await resetDemoWorkspace(db, now, owner)
  assert.ok(reset.revision > changed.revision, `${reset.revision} > ${changed.revision}`)
  assert.deepEqual(reset.lists.map(list => list.name).sort(), sampleNames())
  assert.equal(recordCount(await readWorkspace(db, owner)), recordCount(demoWorkspace(now)))
  await assert.rejects(writeWorkspace(db, owner, changed.revision, { interests: [] }), Conflict)
})

test('a reset deletes the demo account\'s ended sessions and keeps the live ones', database, async () => {
  const owner = newOwner()
  await sql.query(`INSERT INTO typle_auth_users (id, name, email, email_verified, image) VALUES ($1, 'N', $2, true, '')`, [owner, `${owner}@users.invalid`])
  try {
    await sql.query(`INSERT INTO typle_auth_sessions (id, expires_at, token, user_id) VALUES
      ($1, now() - interval '1 hour', $1, $3), ($2, now() + interval '1 hour', $2, $3)`, [`ended-${owner}`, `live-${owner}`, owner])
    await resetDemoWorkspace(db, now, owner)
    const left = (await sql.query('SELECT token FROM typle_auth_sessions WHERE user_id = $1', [owner])).rows.map(row => row.token)
    assert.deepEqual(left, [`live-${owner}`])
  } finally {
    await sql.query('DELETE FROM typle_auth_users WHERE id = $1', [owner])
  }
})

// The cron's request: GET with the secret, as Vercel Cron sends it.
const on = { DEMO_LOGIN: '1', CRON_SECRET: 'cron-secret' }
const request = (authorization, method = 'GET') =>
  new Request('http://127.0.0.1/api/demo/reset', { method, headers: authorization ? { authorization } : {} })
const resets = () => {
  const calls = []
  return { calls, reset: async () => { calls.push(1); return { revision: 7 } } }
}

test('the reset answers the cron\'s secret only', async () => {
  for (const [authorization, env] of [[undefined, on], ['Bearer wrong', on], ['cron-secret', on], ['Bearer ', { ...on, CRON_SECRET: '' }],
    ['Bearer cron-secret', { DEMO_LOGIN: '1' }]]) {
    const { calls, reset } = resets()
    const response = await answerDemoReset(request(authorization), reset, env)
    assert.equal(response.status, 401, `${authorization} ${JSON.stringify(env)}`)
    assert.equal(calls.length, 0)
  }
})

test('the reset is not found while the demo login is off', async () => {
  const { calls, reset } = resets()
  assert.equal((await answerDemoReset(request('Bearer cron-secret'), reset, { CRON_SECRET: 'cron-secret' })).status, 404)
  assert.equal(calls.length, 0)
})

test('the reset with the secret puts the sample back and answers its revision', async () => {
  const { calls, reset } = resets()
  const response = await answerDemoReset(request('Bearer cron-secret'), reset, on)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { revision: 7 })
  assert.equal(calls.length, 1)
})

test('the reset answers GET only', async () => {
  const { reset } = resets()
  const response = await answerDemoReset(request('Bearer cron-secret', 'POST'), reset, on)
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET')
})

test('a reset that fails answers 503', async () => {
  const response = await answerDemoReset(request('Bearer cron-secret'), async () => { throw new Error('down') }, on)
  assert.equal(response.status, 503)
})

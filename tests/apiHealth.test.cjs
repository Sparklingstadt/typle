require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createPool } = require('../src/server/database.ts')
const { checkHealth } = require('../src/server/health.ts')

// The first test runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }

test('200 when the database answers', database, async () => {
  const db = createPool(url)
  try {
    const response = await checkHealth(() => db)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '{"status":"ok"}\n')
  } finally { await db.end() }
})

test('503 when the database is down', async () => {
  const db = createPool('postgres://user:pass@127.0.0.1:1/none')
  try {
    const response = await checkHealth(() => db)
    assert.equal(response.status, 503)
    assert.equal(await response.text(), '{"error":"databaseUnavailable"}\n')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  } finally { await db.end() }
})

test('503 when no database is set', async () => {
  const response = await checkHealth(() => { throw new Error('DATABASE_URL is not set') })
  assert.equal(response.status, 503)
  assert.equal(await response.text(), '{"error":"databaseUnavailable"}\n')
})

test('the route answers other methods with 405', async () => {
  const route = require('../src/app/api/health/route.ts')
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await route[method]()
    assert.equal(response.status, 405, method)
    assert.equal(response.headers.get('allow'), 'GET, HEAD', method)
  }
})

require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { createPool, ping } = require('../src/server/database.ts')

// The first test runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }

test('ping succeeds on the database', database, async () => {
  const db = createPool(url)
  try { await ping(db) } finally { await db.end() }
})

test('ping fails when nothing listens', async () => {
  const db = createPool('postgres://user:pass@127.0.0.1:1/none')
  try { await assert.rejects(ping(db)) } finally { await db.end() }
})

// A server that accepts the connection and never answers: ping must give up on its own.
test('ping gives up after the timeout', async () => {
  const sockets = []
  const server = net.createServer(socket => sockets.push(socket)).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const db = createPool(`postgres://user:pass@127.0.0.1:${server.address().port}/none`)
  const started = Date.now()
  try {
    await assert.rejects(ping(db, 200))
    assert.ok(Date.now() - started < 2_000)
  } finally {
    for (const socket of sockets) socket.destroy()
    server.close()
    await db.end().catch(() => {})
  }
})

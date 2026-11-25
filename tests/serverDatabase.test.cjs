require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { createPool, createPrisma, prismaOn, ping } = require('../src/server/database.ts')

// The first test runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }

test('ping succeeds on the database', database, async () => {
  const db = createPrisma(url)
  try { await ping(db) } finally { await db.$disconnect() }
})

test('ping fails when nothing listens', async () => {
  const db = createPrisma('postgres://user:pass@127.0.0.1:1/none')
  try { await assert.rejects(ping(db, 500)) } finally { await db.$disconnect() }
})

// A server that accepts the connection and never answers: ping must give up on its own.
test('ping gives up after the timeout', async () => {
  const sockets = []
  const server = net.createServer(socket => sockets.push(socket)).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const db = createPrisma(`postgres://user:pass@127.0.0.1:${server.address().port}/none`)
  const started = Date.now()
  try {
    await assert.rejects(ping(db, 200))
    assert.ok(Date.now() - started < 2_000)
  } finally {
    for (const socket of sockets) socket.destroy()
    server.close()
    await db.$disconnect().catch(() => {})
  }
})

// A server that signs the client in and then never answers a query. Each ping must give its connection back to the
// pool (dropped), or a few of them fill it and the instance answers 503 long after the database is back.
test('a query that never answers does not keep its connection', async () => {
  const sockets = []
  const server = net.createServer(socket => {
    sockets.push(socket)
    socket.once('data', () => {
      // AuthenticationOk, then ReadyForQuery (idle); every later message (the query) goes unanswered.
      socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]))
    })
  }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const pool = createPool(`postgres://user:pass@127.0.0.1:${server.address().port}/none`, 200)
  const db = prismaOn(pool)
  try {
    for (let i = 0; i < 7; i++) await assert.rejects(ping(db, 200))
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.deepEqual({ total: pool.totalCount, waiting: pool.waitingCount }, { total: 0, waiting: 0 })
  } finally {
    for (const socket of sockets) socket.destroy()
    server.close()
    await db.$disconnect().catch(() => {})
  }
})

// An idle connection that the database closes makes the pool emit 'error'; without a listener that throws.
test('the pool survives an error on an idle connection', async () => {
  const db = createPool('postgres://user:pass@127.0.0.1:1/none')
  try {
    assert.doesNotThrow(() => db.emit('error', new Error('terminating connection due to administrator command')))
  } finally { await db.end() }
})

// On RDS, DATABASE_URL names the CA bundle in the image (Dockerfile): the server's certificate is verified with it.
test('an RDS URL verifies the server with the CA bundle it names', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const { Client } = require('pg')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typle-ca-'))
  const ca = path.join(dir, 'bundle.pem')
  fs.writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n')
  try {
    const client = new Client({ connectionString: `postgres://u:p@db.example:5432/typle?sslmode=verify-full&sslrootcert=${ca}` })
    const ssl = client.connectionParameters.ssl
    assert.equal(typeof ssl, 'object')
    assert.match(String(ssl.ca), /BEGIN CERTIFICATE/)
    assert.notEqual(ssl.rejectUnauthorized, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

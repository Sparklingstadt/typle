require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomInt } = require('node:crypto')
const { createPool, createPrisma } = require('../src/server/database.ts')
const { readSavedWorkspace, workspaceAnswer } = require('../src/server/workspace.ts')
const { withRecords } = require('../src/server/records.ts')
const { DEFAULT_INTERESTS } = require('../src/lib/interests.ts')

const at = '2026-09-07T00:00:00.000Z'
const word = { display: 'a', input: 'a', annotation: '' }
const record = (id, time) => ({ ...(id === undefined ? {} : { id }), time, date: at })
const list = (id, records = [], extra = {}) => ({ id, name: id, packId: 'pack-a', words: [word], records, createdAt: at, ...extra })
const packs = [{ id: 'pack-a', name: 'A', createdAt: at }]

// The Go backend's withRecords: a list's own records first, then the table's; a record of the same id is the table's.
test('the stored records are put back in their lists', () => {
  const lists = [list('l1', [record('a', 1), record('b', 2), record(undefined, 3)]), list('l2'), list('l3', [record('x', 9)])]
  const stored = new Map([['l1', [record('b', 20), record('c', 30)]], ['gone', [record('z', 99)]]])
  const merged = withRecords(lists, stored)
  assert.deepEqual(merged[0].records, [record('a', 1), record(undefined, 3), record('b', 20), record('c', 30)])
  assert.deepEqual(merged[1].records, [])
  assert.deepEqual(merged[2].records, [record('x', 9)])
})

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
// The code under test gets Prisma Client; the tests set up and look at the tables with SQL, as the fixtures were made.
const sql = url ? createPool(url) : null
const db = url ? createPrisma(url) : null
const owners = []
after(async () => {
  if (!db) return
  await sql.query('DELETE FROM typle_records WHERE owner_id = ANY($1)', [owners])
  await sql.query('DELETE FROM typle_workspaces WHERE owner_id = ANY($1)', [owners])
  await sql.end()
  await db.$disconnect()
})
const newOwner = () => {
  const owner = `github:${randomInt(1e9, 2e9)}`
  owners.push(owner)
  return owner
}

async function insertRow(owner, { lists, packs: rowPacks = packs, devices = [], interests = null, revision = 3, split = false }) {
  await sql.query(`INSERT INTO typle_workspaces (owner_id, lists, packs, devices, interests, revision, records_split)
    VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)`,
  [owner, JSON.stringify(lists), rowPacks === null ? null : JSON.stringify(rowPacks), JSON.stringify(devices),
    interests === null ? null : JSON.stringify(interests), revision, split])
}

test('an account that has saved nothing reads as revision 0', database, async () => {
  const owner = newOwner()
  assert.equal(await readSavedWorkspace(db, owner), null)
  assert.deepEqual(workspaceAnswer(null, owner), { lists: [], packs: null, devices: [], interests: [...DEFAULT_INTERESTS], revision: 0, accountId: owner })
})

test('a row is answered as saved, with the default interests when it has none', database, async () => {
  const owner = newOwner()
  const lists = [list('l1', [record('a', 1)], { unknown: { kept: true } })]
  await insertRow(owner, { lists, devices: [{ id: 'd', name: 'D', layout: '' }] })
  const saved = await readSavedWorkspace(db, owner)
  const answer = workspaceAnswer(saved, owner)
  assert.deepEqual(Object.keys(answer), ['lists', 'packs', 'devices', 'interests', 'revision', 'accountId'])
  assert.deepEqual(answer, { lists, packs, devices: [{ id: 'd', name: 'D', layout: '' }], interests: [...DEFAULT_INTERESTS], revision: 3, accountId: owner })
})

test('the records of a split row come back from typle_records', database, async () => {
  const owner = newOwner()
  await insertRow(owner, { lists: [list('l1', [record('own', 1)]), list('l2')], interests: ['programming'], split: true })
  for (const [listId, recordId, position, data] of [['l1', 'b', 0, record('b', 2)], ['l1', 'c', 1, record('c', 3)], ['gone', 'z', 0, record('z', 9)]]) {
    await sql.query(`INSERT INTO typle_records (owner_id, list_id, record_id, position, at, data) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [owner, listId, recordId, position, at, JSON.stringify(data)])
  }
  const answer = workspaceAnswer(await readSavedWorkspace(db, owner), owner)
  assert.deepEqual(answer.lists[0].records, [record('own', 1), record('b', 2), record('c', 3)])
  assert.deepEqual(answer.lists[1].records, [])
  assert.deepEqual(answer.interests, ['programming'])
})

test('lists saved before packs read with packs null, and optional fields saved as null read', database, async () => {
  const owner = newOwner()
  const lists = [{ id: 'old', name: 'Old', words: [word], records: [{ ...record('r', 1), device: null }], createdAt: at, tags: null }]
  await insertRow(owner, { lists, packs: null })
  const answer = workspaceAnswer(await readSavedWorkspace(db, owner), owner)
  assert.equal(answer.packs, null)
  // Answered as saved, nulls and all: the app reads them as left out too.
  assert.deepEqual(answer.lists, lists)
})

test('a row that cannot be read is an error', database, async () => {
  const owner = newOwner()
  await insertRow(owner, { lists: [{ id: 'broken' }] })
  await assert.rejects(readSavedWorkspace(db, owner))
})

// A read waits for a free connection as a query does (5 s), not Prisma's 2 s for a transaction.
test('a read waits for a connection while all of them are busy', database, async () => {
  // Prisma runs a query once it is awaited: then() starts the five now, which take every connection of the pool.
  const busy = Array.from({ length: 5 }, () => db.$queryRaw`SELECT 1 FROM pg_sleep(2.6)`.then(rows => rows))
  await new Promise(resolve => setTimeout(resolve, 200))
  const { readWorkspace } = require('../src/server/workspace.ts')
  assert.equal(await readWorkspace(db, `github:${randomInt(1e9, 2e9)}`), null)
  await Promise.all(busy)
})

require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomInt } = require('node:crypto')
const { createPool, createPrisma } = require('../src/server/database.ts')
const { modifyWorkspace, writeWorkspace, readWorkspaceChange, Conflict } = require('../src/server/workspace.ts')
const { addRecord } = require('../src/lib/records.ts')

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
// The code under test gets Prisma Client; the tests set up and look at the tables with SQL, as the fixtures were made.
const sql = url ? createPool(url) : null
const db = url ? createPrisma(url) : null
const owners = []
after(async () => {
  if (!db) return
  for (const table of ['typle_records', 'typle_workspaces']) await sql.query(`DELETE FROM ${table} WHERE owner_id = ANY($1)`, [owners])
  await sql.end()
  await db.$disconnect()
})

const at = '2026-09-07T00:00:00.000Z'
const word = { display: 'ab', input: 'ab', annotation: '' }
const list = (id, extra = {}) => ({ id, name: id, packId: 'p', words: [word], records: [], createdAt: at, ...extra })
const run = id => ({ id, time: 2.5, date: '2026-10-02T10:00:00.000Z', mistakes: 1, accuracy: 95.5, wordCount: 1 })

async function account(lists = [list('l1')]) {
  const owner = `github:${randomInt(1e9, 2e9)}`
  owners.push(owner)
  const read = readWorkspaceChange({ revision: 0, lists, packs: [{ id: 'p', name: 'P', createdAt: at }] })
  await writeWorkspace(db, owner, 0, read.change)
  return owner
}
const revision = async owner => (await sql.query('SELECT revision FROM typle_workspaces WHERE owner_id = $1', [owner])).rows[0].revision
const add = (listId, input) => document => {
  const { document: next, record, added } = addRecord(document, listId, input)
  return { document: next, changed: added, result: record }
}

test('a change is saved with its records, and the revision goes up', database, async () => {
  const owner = await account()
  const { result, saved } = await modifyWorkspace(db, owner, add('l1', run('r1')))
  assert.equal(result.id, 'r1')
  assert.equal(saved.revision, 2)
  assert.deepEqual(saved.lists[0].records.map(record => record.id), ['r1'])
  const { rows } = await sql.query('SELECT record_id FROM typle_records WHERE owner_id = $1', [owner])
  assert.deepEqual(rows.map(row => row.record_id), ['r1'])
})

test('nothing changed is nothing written', database, async () => {
  const owner = await account()
  await modifyWorkspace(db, owner, add('l1', run('r1')))
  const { saved } = await modifyWorkspace(db, owner, add('l1', run('r1')))
  assert.equal(saved.revision, 2)
  assert.equal(await revision(owner), 2)
})

test('a refusal of the change is thrown and nothing is written', database, async () => {
  const owner = await account()
  await assert.rejects(modifyWorkspace(db, owner, add('nope', run('r1'))), { key: 'recordListDeleted' })
  assert.equal(await revision(owner), 1)
})

// The lists may not grow past 896 KiB; a change that leaves them no larger is let through, so an oversized workspace can
// still be made smaller.
test('a change that makes the lists too large is refused', database, async () => {
  const big = Array.from({ length: 9 }, (_, n) => list(`l${n}`, { words: Array.from({ length: 1000 }, (_, w) => ({ display: `${'x'.repeat(90)}${w}`, input: 'x', annotation: '' })) }))
  const owner = await account(big)
  const before = await revision(owner)
  await assert.rejects(modifyWorkspace(db, owner, add('l0', run('r1'))), { key: 'workspaceTooLarge' })
  assert.equal(await revision(owner), before)
  // Taking words out of a list makes it smaller, and is saved.
  await modifyWorkspace(db, owner, document => ({ document: { ...document, lists: document.lists.map((item, n) => n ? item : { ...item, words: [word] }) }, changed: true, result: null }))
  assert.equal(await revision(owner), before + 1)
})

// A record added while a save of the lists made from an earlier revision comes in: the record stays, the save is told to
// reload.
test('a record added at the same time as a save is kept, and the save from before it is a conflict', database, async () => {
  const owner = await account()
  const stale = readWorkspaceChange({ revision: 1, lists: [list('l1', { name: 'renamed' })], packs: [{ id: 'p', name: 'P', createdAt: at }] })
  const [added, saved] = await Promise.allSettled([modifyWorkspace(db, owner, add('l1', run('r1'))), writeWorkspace(db, owner, 1, stale.change)])
  assert.equal(added.status, 'fulfilled')
  if (saved.status === 'fulfilled') {
    // The save came first: the record was then added to the renamed list.
    assert.equal(added.value.saved.lists[0].name, 'renamed')
  } else {
    assert.ok(saved.reason instanceof Conflict)
  }
  const { rows } = await sql.query('SELECT record_id FROM typle_records WHERE owner_id = $1', [owner])
  assert.deepEqual(rows.map(row => row.record_id), ['r1'])
})

// Two records added at once: the row is held by one change at a time, so both are kept and the revision goes up twice.
test('two record adds at once keep both records', database, async () => {
  const owner = await account()
  const results = await Promise.allSettled([modifyWorkspace(db, owner, add('l1', run('a'))), modifyWorkspace(db, owner, add('l1', run('b')))])
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled'])
  const { rows } = await sql.query('SELECT record_id FROM typle_records WHERE owner_id = $1 ORDER BY record_id', [owner])
  assert.deepEqual(rows.map(row => row.record_id), ['a', 'b'])
  assert.equal(await revision(owner), 3)
})

// A change that waits too long for the row gives up, and its connection goes back to the pool out of its transaction:
// the server cancels the statement before the client stops waiting, so nothing is left waiting for, or holding, the row.
test('a change that times out waiting for the row leaves nothing behind', database, async () => {
  const owner = await account()
  const holder = await sql.connect()
  try {
    await holder.query('BEGIN')
    await holder.query('SELECT 1 FROM typle_workspaces WHERE owner_id = $1 FOR UPDATE', [owner])
    const { rows: [{ pid }] } = await holder.query('SELECT pg_backend_pid() AS pid')
    await assert.rejects(modifyWorkspace(db, owner, add('l1', run('late'))))
    const { rows: [{ waiting }] } = await sql.query(
      'SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])
    assert.equal(waiting, 0)
  } finally {
    await holder.query('ROLLBACK')
    holder.release()
  }
})

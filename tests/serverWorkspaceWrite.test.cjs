require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomInt } = require('node:crypto')
const { createPool, createPrisma } = require('../src/server/database.ts')
const { readWorkspaceChange, writeWorkspace, Conflict } = require('../src/server/workspace.ts')

// The scenarios were run by the Go backend against a real database (tests/fixtures/workspace-writes.json): each save
// here must answer as it did and leave the same row, records and links.
const { scenarios } = require('./fixtures/workspace-writes.json')

const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
// The code under test gets Prisma Client; the tests set up and look at the tables with SQL, as the fixtures were made.
const sql = url ? createPool(url) : null
const db = url ? createPrisma(url) : null
const owners = []
after(async () => {
  if (!db) return
  for (const table of ['typle_records', 'typle_workspaces']) {
    await sql.query(`DELETE FROM ${table} WHERE owner_id = ANY($1)`, [owners])
  }
  await sql.end()
  await db.$disconnect()
})
const newOwner = () => {
  const owner = `github:${randomInt(1e9, 2e9)}`
  owners.push(owner)
  return owner
}

/** The save of body as /api/workspace answers it: ok, or the key it is refused with. */
async function save(owner, body) {
  const read = readWorkspaceChange({ ...body, accountId: owner })
  if ('refusal' in read) return read.refusal
  try {
    await writeWorkspace(db, owner, read.revision, read.change)
    return 'ok'
  } catch (error) {
    if (error instanceof Conflict) return 'conflict'
    if (error?.key) return error.key
    throw error
  }
}

async function state(owner) {
  const row = (await sql.query(`SELECT COALESCE((SELECT jsonb_build_object('lists', lists, 'packs', packs, 'devices', devices, 'interests', interests,
    'revision', revision, 'split', records_split) FROM typle_workspaces WHERE owner_id = $1), 'null'::jsonb)::text AS v`, [owner])).rows[0].v
  const records = (await sql.query(`SELECT COALESCE(jsonb_agg(jsonb_build_array(list_id, record_id, position, (extract(epoch FROM at) * 1000)::bigint, data)
    ORDER BY list_id, position), '[]'::jsonb)::text AS v FROM typle_records WHERE owner_id = $1`, [owner])).rows[0].v
  return { row: JSON.parse(row), records: JSON.parse(records) }
}

for (const scenario of scenarios) {
  test(`as the Go backend: ${scenario.name}`, database, async () => {
    const owner = newOwner()
    const row = scenario.setup?.row
    if (row) {
      await sql.query(`INSERT INTO typle_workspaces (owner_id, lists, packs, devices, interests, revision, records_split)
        VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)`,
      [owner, JSON.stringify(row.lists), row.packs === null ? null : JSON.stringify(row.packs), JSON.stringify(row.devices),
        row.interests === null ? null : JSON.stringify(row.interests), row.revision, row.split])
    }
    for (const [index, step] of scenario.steps.entries()) {
      assert.equal(await save(owner, step.body), step.result, `step ${index + 1}`)
      assert.deepEqual(await state(owner), { row: step.row, records: step.records }, `step ${index + 1}`)
    }
  })
}

// Two saves from the same revision at once: one is saved, the other is told that the workspace moved on.
test('of two saves from the same revision, only one is saved', database, async () => {
  const owner = newOwner()
  const at = '2026-09-07T00:00:00.000Z'
  const body = name => ({ revision: 0, packs: [{ id: 'p', name: 'P', createdAt: at }],
    lists: [{ id: 'l', name, packId: 'p', words: [{ display: 'a', input: 'a', annotation: '' }], records: [], createdAt: at }] })
  const results = await Promise.all([save(owner, body('one')), save(owner, body('two'))])
  assert.deepEqual(results.sort(), ['conflict', 'ok'])
  const again = await Promise.all([save(owner, { ...body('three'), revision: 1 }), save(owner, { ...body('four'), revision: 1 })])
  assert.deepEqual(again.sort(), ['conflict', 'ok'])
  assert.equal((await state(owner)).row.revision, 2)
})

const at = '2026-09-07T00:00:00.000Z'
const runs = n => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, time: 1, date: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }))
const withRuns = (revision, records) => ({ revision, packs: [{ id: 'p', name: 'P', createdAt: at }],
  lists: [{ id: 'l', name: 'L', packId: 'p', words: [{ display: 'a', input: 'a', annotation: '' }], records, createdAt: at }] })

// The parts a first save leaves out are SQL NULL, as the app reads them: not JSON null.
test('a first save without lists keeps packs and interests NULL', database, async () => {
  const owner = newOwner()
  await writeWorkspace(db, owner, 0, { devices: [] })
  const { rows } = await sql.query(`SELECT packs IS NULL AS packs, interests IS NULL AS interests, lists::text AS lists
    FROM typle_workspaces WHERE owner_id = $1`, [owner])
  assert.deepEqual(rows[0], { packs: true, interests: true, lists: '[]' })
})

// Deleting a record moves every later one up a place; the rows follow, and the order reads back the same.
test('deleting the first record renumbers the rest', database, async () => {
  const owner = newOwner()
  assert.equal(await save(owner, withRuns(0, runs(3))), 'ok')
  assert.equal(await save(owner, withRuns(1, runs(3).slice(1))), 'ok')
  const { records } = await state(owner)
  assert.deepEqual(records.map(([, id, position]) => [id, position]), [['r1', 0], ['r2', 1]])
})

// A save that leaves a record as it was does not write its row again.
test('a record that did not change keeps its row', database, async () => {
  const owner = newOwner()
  assert.equal(await save(owner, withRuns(0, runs(2))), 'ok')
  const versions = async () => (await sql.query('SELECT record_id, xmin::text AS v FROM typle_records WHERE owner_id = $1 ORDER BY record_id', [owner])).rows
  const before = await versions()
  assert.equal(await save(owner, withRuns(1, [...runs(2), { id: 'new', time: 9, date: at }])), 'ok')
  const after = await versions()
  assert.deepEqual(after.filter(row => row.record_id !== 'new'), before)
  assert.equal(after.length, 3)
})

// A large account: the save is not cut off part way, and every record is saved.
test('a save of 5000 records', database, async () => {
  const owner = newOwner()
  assert.equal(await save(owner, withRuns(0, runs(5000))), 'ok')
  assert.equal(await save(owner, withRuns(1, runs(5000).slice(1))), 'ok')
  const { rows } = await sql.query('SELECT count(*)::int AS n, min(position) AS first, max(position) AS last FROM typle_records WHERE owner_id = $1', [owner])
  assert.deepEqual(rows[0], { n: 4999, first: 0, last: 4998 })
})

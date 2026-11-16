require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomInt } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { readWorkspaceChange, writeWorkspace, Conflict } = require('../src/server/workspace.ts')

// The scenarios were run by the Go backend against a real database (tests/fixtures/workspace-writes.json): each save
// here must answer as it did and leave the same row, records and links.
const { scenarios } = require('./fixtures/workspace-writes.json')

const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const owners = []
after(async () => {
  if (!db) return
  for (const table of ['typle_records', 'typle_workspaces']) {
    await db.query(`DELETE FROM ${table} WHERE owner_id = ANY($1)`, [owners])
  }
  await db.end()
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
  const row = (await db.query(`SELECT COALESCE((SELECT jsonb_build_object('lists', lists, 'packs', packs, 'devices', devices, 'interests', interests,
    'revision', revision, 'split', records_split) FROM typle_workspaces WHERE owner_id = $1), 'null'::jsonb)::text AS v`, [owner])).rows[0].v
  const records = (await db.query(`SELECT COALESCE(jsonb_agg(jsonb_build_array(list_id, record_id, position, (extract(epoch FROM at) * 1000)::bigint, data)
    ORDER BY list_id, position), '[]'::jsonb)::text AS v FROM typle_records WHERE owner_id = $1`, [owner])).rows[0].v
  return { row: JSON.parse(row), records: JSON.parse(records) }
}

for (const scenario of scenarios) {
  test(`as the Go backend: ${scenario.name}`, database, async () => {
    const owner = newOwner()
    const row = scenario.setup?.row
    if (row) {
      await db.query(`INSERT INTO typle_workspaces (owner_id, lists, packs, devices, interests, revision, records_split)
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

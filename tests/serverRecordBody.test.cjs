require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readRecordAdd, readRecordDelete } = require('../src/server/workspace.ts')

const run = { id: 'run-1', time: 2.5, date: '2026-10-02T10:00:00.000Z', mistakes: 1, accuracy: 95.5, wordCount: 1, deviceId: 'mac' }
const add = fields => readRecordAdd({ accountId: 'github:1', ...fields })
const remove = fields => readRecordDelete({ accountId: 'github:1', ...fields })

// The bodies the Go backend refused with invalidRecord (its records_test.go, deleted in v2.46.7).
test('a POST body has exactly the account, a list id and a record with its id', () => {
  assert.deepEqual(add({ listId: 'one', record: run }), { listId: 'one', input: run })
  const { id: _id, ...withoutId } = run
  for (const fields of [
    { listId: 'one', record: withoutId },
    { listId: 'one', record: { ...run, id: null } },
    { listId: 'one', record: { keys: [1], ...run } },
    { listId: 'one', record: { ...run, foo: 1 } },
    { listId: 'one', record: run, revision: 1 },
    { record: run },
    { listId: '', record: run },
    { listId: 1, record: run },
    { listId: 'one', record: null },
    { listId: 'one', record: [run] },
    { listId: 'one', record: 'x' },
  ]) {
    assert.equal(add(fields), null, JSON.stringify(fields))
  }
})

// The owner decided to answer as the Go backend did: these fields sent as null are left out.
test('wordCount, device and deviceId sent as null are left out', () => {
  assert.deepEqual(add({ listId: 'one', record: { ...run, wordCount: null, device: null, deviceId: null } }).input,
    (({ wordCount: _w, deviceId: _d, ...rest }) => rest)(run))
})

test('a DELETE body has exactly the account, a list id and a record id', () => {
  assert.deepEqual(remove({ listId: 'one', recordId: 'run-1' }), { listId: 'one', recordId: 'run-1' })
  for (const fields of [{ listId: 'one' }, { listId: 'one', recordId: '' }, { listId: 'one', recordId: 'run-1', revision: 3 }, { listId: '', recordId: 'r' }, { listId: 'one', recordId: 1 }]) {
    assert.equal(remove(fields), null, JSON.stringify(fields))
  }
})

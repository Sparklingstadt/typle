require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { goFloat, legacyId } = require('../src/server/records.ts')

// The values were made by the Go backend (strconv.FormatFloat and store.legacyID), so a record saved by either side
// gets the same id.
const fixture = require('./fixtures/record-ids.json')

test('a number is written as Go writes it with %g', () => {
  for (const { value, go } of fixture.floats) assert.equal(goFloat(value), go, String(value))
})

test('a record without an id gets the id the Go backend gave it', () => {
  for (const { listId, position, date, time, id } of fixture.ids) assert.equal(legacyId(listId, position, { date, time }), id)
})

// Every record gets an id that keeps it apart from the rest of its list: its own, unless it has none or an earlier
// record of the list has it; then the legacy id of its place.
test('the records of the lists become rows, each with an id of its own', () => {
  const { recordRows } = require('../src/server/records.ts')
  const date = '2026-09-07T00:00:00.000Z'
  const lists = [
    { id: 'l1', records: [{ id: 'a', time: 1, date }, { time: 2, date }, { id: 'a', time: 3, date, extra: 'kept' }] },
    { id: 'l2', records: [] },
    { id: 'l3', records: [{ id: '', time: 4, date }] },
  ]
  const rows = recordRows(lists)
  assert.deepEqual(rows.map(row => [row.listId, row.recordId, row.position]), [
    ['l1', 'a', 0], ['l1', legacyId('l1', 1, { date, time: 2 }), 1], ['l1', legacyId('l1', 2, { date, time: 3 }), 2],
    ['l3', legacyId('l3', 0, { date, time: 4 }), 0],
  ])
  assert.deepEqual(JSON.parse(rows[2].data), { id: legacyId('l1', 2, { date, time: 3 }), time: 3, date, extra: 'kept' })
  assert.equal(rows[0].at.toISOString(), date)
  // The lists' records get their ids too, as the Go backend gave them in place.
  assert.equal(lists[0].records[1].id, rows[1].recordId)
})

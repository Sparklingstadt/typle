require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { demoWorkspace } = require('../src/server/demoWorkspace.ts')
const { decodeDocument } = require('../src/lib/workspaceDocument.ts')
const { isFollowed } = require('../src/lib/followedPacks.ts')

// The sample the shared demo account starts from, and is put back to every day (src/server/demoReset.ts).
const now = new Date('2026-11-28T19:00:00Z')
const day = 24 * 60 * 60 * 1000

test('the demo sample is a workspace the app reads', () => {
  const sample = demoWorkspace(now)
  const document = decodeDocument(sample)
  assert.ok(document.interests.length > 0)
  assert.equal(sample.devices.length, 1)
})

test('the demo sample has lists of its own, with words, and follows two official packs', () => {
  const { lists, packs } = demoWorkspace(now)
  const followedIds = new Set(packs.filter(isFollowed).map(pack => pack.id))
  assert.equal(followedIds.size, 2)
  const own = lists.filter(list => !followedIds.has(list.packId))
  assert.ok(own.length >= 2, `${own.length} own lists`)
  for (const list of own) assert.ok(list.words.length >= 5, `${list.name}: ${list.words.length} words`)
})

/** Monday 00:00 in Japan of the week of at: the week the dashboard shows to a viewer there. */
const weekStartInJapan = (at) => {
  const japan = new Date(at.getTime() + 9 * 60 * 60 * 1000)
  const monday = Date.UTC(japan.getUTCFullYear(), japan.getUTCMonth(), japan.getUTCDate()) - ((japan.getUTCDay() + 6) % 7) * day
  return monday - 9 * 60 * 60 * 1000
}

// The cron runs at 4:00 in Japan: a Monday reset leaves the least of the week, a Thursday one more, and the first
// login may come just after midnight.
for (const [when, iso] of [['Monday', '2026-11-29T19:00:00Z'], ['Thursday', '2026-12-02T19:00:00Z'], ['Monday just after midnight', '2026-11-29T15:10:00Z']]) {
  test(`the demo records of a ${when} reset fill this week in Japan, with some the week before`, () => {
    const at = new Date(iso)
    const start = weekStartInJapan(at)
    const dates = demoWorkspace(at).lists.flatMap(list => list.records ?? []).map(record => Date.parse(record.date))
    assert.ok(dates.length >= 10, `${dates.length} records`)
    for (const date of dates) assert.ok(date <= at.getTime() && date > start - 7 * day, new Date(date).toISOString())
    assert.ok(dates.filter(date => date >= start).length >= 8, 'this week')
    assert.ok(dates.some(date => date < start), 'last week')
  })
}

test('an official pack gone from the catalog is left out of the demo sample, not an error', () => {
  const { packs } = demoWorkspace(now, ['pack-english-basic-words', 'pack-no-such-pack'])
  assert.equal(packs.filter(isFollowed).length, 1)
})

test('the demo sample is the same for the same time', () => {
  assert.deepEqual(demoWorkspace(now), demoWorkspace(now))
})

test('the demo runs that were not perfect name their missed words, so the weak words have some', () => {
  const records = demoWorkspace(now).lists.flatMap(list => list.records ?? [])
  const missed = records.filter(record => record.accuracy < 100)
  assert.ok(missed.length > 0)
  for (const record of missed) assert.ok(record.missed?.length > 0, record.id)
  assert.ok(records.some(record => record.missed?.some(item => item.word === 'idempotent')))
})

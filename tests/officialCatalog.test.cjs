require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { officialPacks, followed: followedByAll, followOfficialPack: followInAll } = require('../src/lib/packs/catalog.ts')
const { withoutFollowedWords } = require('../src/lib/followedPacks.ts')
const catalog = require('../src/lib/packs/officialCatalog.ts')

// The browser's catalog (officialCatalog.ts: a summary of every pack, and the words of one pack at a time) must say
// what the whole catalog (catalog.ts, on the server) says.
const now = new Date('2026-11-28T00:00:00Z')
const ids = (entry, prefix) => ({ pack: prefix, lists: entry.lists.map((_, n) => `${prefix}-${n}`) })

test('the summary is every official pack in order without its words, made by scripts/generate-packs.cjs', () => {
  assert.deepEqual(require('../scripts/generate-packs.cjs').check(), [])
  assert.deepEqual(catalog.packSummaries(), officialPacks().map(entry => ({
    ...entry, lists: entry.lists.map(({ words, ...list }) => ({ ...list, wordCount: words.length, sample: words.slice(0, 3).map(word => word.display) })),
  })))
})

test('a library that follows packs is brought in line with them as the whole catalog does, loading only their words', async () => {
  const [first, second, third] = officialPacks()
  // Before anything is loaded: following a pack whose words are not there is refused, not saved without them.
  assert.equal(catalog.catalogFor([{ id: 'x', name: 'X', createdAt: '', origin: { catalogId: third.catalogId, version: 1, followed: true } }]), null)
  assert.throws(() => catalog.followOfficialPack({ lists: [], packs: [] }, third.catalogId, ids(third, 'c'), now), /not loaded/)
  let library = followInAll({ lists: [], packs: [] }, first.catalogId, ids(first, 'a'), now)
  library = followInAll(library, second.catalogId, ids(second, 'b'), now)
  const mine = { id: 'own', name: 'Own', createdAt: now.toISOString() }
  // A copy from before v0.98.0 (a pack whose id is a catalog id) is removed, which needs the ids of packs not loaded.
  const copy = { id: third.catalogId, name: 'Copy', createdAt: now.toISOString() }
  const list = pack => ({ id: `${pack.id}-l`, name: 'L', packId: pack.id, words: [{ display: 'a', input: 'a', annotation: '' }], records: [], createdAt: now.toISOString() })
  const saved = withoutFollowedWords({ packs: [...library.packs, mine, copy], lists: [...library.lists, list(mine), list(copy)] })
  const state = { ...saved, accountId: 'github:1', revision: 3, devices: [], interests: [] }
  assert.deepEqual(await catalog.followed(state), followedByAll(state))
  assert.ok(catalog.catalogFor(saved.packs))
  // The packs the library does not follow have no words here.
  const here = new Map(catalog.catalogFor(saved.packs).map(entry => [entry.catalogId, entry]))
  assert.deepEqual(here.get(first.catalogId), first)
  assert.deepEqual(here.get(second.catalogId), second)
  assert.ok(here.get(third.catalogId).lists.every(item => item.words.length === 0))
  // A pack the catalog no longer has needs no loading; it is removed, as by the whole catalog.
  const gone = { ...state, packs: [...state.packs, { id: 'g', name: 'Gone', createdAt: '', origin: { catalogId: 'pack-gone', version: 1, followed: true } }] }
  assert.deepEqual(await catalog.followed(gone), followedByAll(gone))
})

test('following and the choices of the interests screen give what the whole catalog gives, once the packs are loaded', async () => {
  const choices = require('../src/lib/catalogChoices.ts')
  const [first, , , fourth, fifth] = officialPacks()
  const start = followInAll({ lists: [], packs: [] }, first.catalogId, ids(first, 'a'), now)
  await catalog.loadOfficialPacks([first.catalogId])
  assert.throws(() => catalog.followOfficialPack(start, fourth.catalogId, ids(fourth, 'd'), now), /not loaded/)
  await catalog.loadOfficialPacks([fourth.catalogId, fifth.catalogId, 'pack-gone'])
  assert.deepEqual(catalog.followOfficialPack(start, fourth.catalogId, ids(fourth, 'd'), now), followInAll(start, fourth.catalogId, ids(fourth, 'd'), now))
  assert.throws(() => catalog.followOfficialPack(start, 'pack-gone', { pack: 'x', lists: [] }, now), { key: 'packDeleted' })
  const chosen = [{ catalogId: fourth.catalogId, follow: true }, { catalogId: fifth.catalogId, follow: true }, { catalogId: first.catalogId, follow: false }]
  const newIds = entry => ids(entry, `n-${entry.catalogId}`)
  assert.deepEqual(catalog.applyCatalogChoices(start, chosen, newIds, now), choices.applyCatalogChoices(start, officialPacks(), chosen, newIds, now))
  assert.deepEqual(catalog.catalogEntries(start).filter(entry => entry.followed).map(entry => entry.catalogId), [first.catalogId])
})

test('every official pack loads to what the whole catalog has', async () => {
  await catalog.loadOfficialPacks(officialPacks().map(entry => entry.catalogId))
  assert.deepEqual(catalog.catalogFor(officialPacks().map(entry => ({ id: entry.catalogId, name: '', createdAt: '', origin: { catalogId: entry.catalogId, version: 1, followed: true } }))), officialPacks())
})

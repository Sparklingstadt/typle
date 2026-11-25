require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { INTEREST_OPTIONS, matchesInterests } = require('../src/lib/interests.ts')
const { officialPacks } = require('../src/lib/packs/catalog.ts')
const { WELCOME_PACKS, WELCOME_DISMISSED_KEY, welcomePacks, hasChildInterest, shouldWelcome, isWelcomeDismissed, dismissWelcome } = require('../src/lib/welcome.ts')

const memoryStorage = () => {
  const map = new Map()
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)) } }
}

test('every child interest has a welcome pack that exists and fits it', () => {
  for (const option of INTEREST_OPTIONS) for (const child of option.children) {
    const catalogId = WELCOME_PACKS[child.id]
    assert.ok(catalogId, child.id)
    const entry = officialPacks().find(item => item.catalogId === catalogId)
    assert.ok(entry, catalogId)
    assert.equal(matchesInterests(entry.pack, [option.id, child.id]), true, child.id)
  }
  assert.deepEqual(Object.keys(WELCOME_PACKS).sort(), INTEREST_OPTIONS.flatMap(o => o.children.map(c => c.id)).sort())
})

test('the table is the spec table', () => {
  assert.equal(WELCOME_PACKS['language/zh'], 'pack-chinese-basics')
  assert.equal(WELCOME_PACKS['programming/shell'], 'pack-8f3cf116-1f9f-4579-a071-e600094b104d')
  assert.equal(WELCOME_PACKS['programming/linux'], 'pack-0b27f311-38aa-40aa-9c29-ea17e374e1fe')
})

test('welcomePacks: children in option order, parents ignored, no duplicates', () => {
  const ids = interests => welcomePacks(interests).map(entry => entry.catalogId)
  assert.deepEqual(ids(['programming', 'programming/go', 'language', 'language/zh']), ['pack-chinese-basics', 'pack-go-syntax-beginner'])
  assert.deepEqual(ids(['language']), [])
  assert.deepEqual(ids([]), [])
})

test('hasChildInterest', () => {
  assert.equal(hasChildInterest(['language']), false)
  assert.equal(hasChildInterest(['language', 'language/en']), true)
})

test('shouldWelcome only for revision 0 without the mark', () => {
  assert.equal(shouldWelcome({ revision: 0, dismissed: false }), true)
  assert.equal(shouldWelcome({ revision: 0, dismissed: true }), false)
  assert.equal(shouldWelcome({ revision: 1, dismissed: false }), false)
  assert.equal(shouldWelcome({ revision: null, dismissed: false }), false)
})

test('the mark is kept per account', () => {
  const storage = memoryStorage()
  assert.equal(isWelcomeDismissed('guest:local', storage), false)
  dismissWelcome('guest:local', storage)
  dismissWelcome('guest:local', storage)
  assert.equal(isWelcomeDismissed('guest:local', storage), true)
  assert.equal(isWelcomeDismissed('github:1', storage), false)
  assert.deepEqual(JSON.parse(storage.getItem(WELCOME_DISMISSED_KEY)), ['guest:local'])
})

test('a broken or unavailable storage never throws', () => {
  const storage = memoryStorage(); storage.setItem(WELCOME_DISMISSED_KEY, '{oops')
  assert.equal(isWelcomeDismissed('guest:local', storage), false)
  const failing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(isWelcomeDismissed('guest:local', failing), false)
  assert.doesNotThrow(() => dismissWelcome('guest:local', failing))
  const notArray = memoryStorage(); notArray.setItem(WELCOME_DISMISSED_KEY, '{"a":1}')
  assert.equal(isWelcomeDismissed('a', notArray), false)
  dismissWelcome('a', notArray)
  assert.equal(isWelcomeDismissed('a', notArray), true)
})

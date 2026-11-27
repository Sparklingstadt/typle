require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { INTEREST_OPTIONS, matchesInterests } = require('../src/lib/interests.ts')
const { officialPacks } = require('../src/lib/packs/catalog.ts')
const { WELCOME_PACKS, WELCOME_DISMISSED_KEY, NATIVE_LANGUAGE_NAMES, welcomePacks, hasChildInterest, shouldWelcome, isWelcomeDismissed, dismissWelcome, toggleWelcomeInterest, welcomeKey, carryChecks, demoProgress } = require('../src/lib/welcome.ts')

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
  assert.equal(isWelcomeDismissed('guest:broken', storage), false)
  const failing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(isWelcomeDismissed('guest:broken', failing), false)
  assert.doesNotThrow(() => dismissWelcome('guest:broken', failing))
  const notArray = memoryStorage(); notArray.setItem(WELCOME_DISMISSED_KEY, '{"a":1}')
  assert.equal(isWelcomeDismissed('a', notArray), false)
  dismissWelcome('a', notArray)
  assert.equal(isWelcomeDismissed('a', notArray), true)
})

test('a mark that cannot be written still counts for this page session', () => {
  const failing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(isWelcomeDismissed('github:1', failing), false)
  dismissWelcome('github:1', failing)
  assert.equal(isWelcomeDismissed('github:1', failing), true)
  assert.equal(isWelcomeDismissed('github:2', failing), false)
})

test('every welcome pack has at least one list with at least one word', () => {
  for (const catalogId of Object.values(WELCOME_PACKS)) {
    const entry = officialPacks().find(item => item.catalogId === catalogId)
    assert.ok(entry.lists.length > 0, catalogId)
    assert.ok(entry.lists.some(list => list.words.length > 0), catalogId)
  }
})

test('toggleWelcomeInterest adds and drops the parent with its children', () => {
  assert.deepEqual(toggleWelcomeInterest([], 'language/zh'), ['language', 'language/zh'])
  assert.deepEqual(toggleWelcomeInterest(['language', 'language/zh'], 'programming/go'), ['language', 'language/zh', 'programming', 'programming/go'])
  assert.deepEqual(toggleWelcomeInterest(['language', 'language/zh', 'language/ru'], 'language/zh'), ['language', 'language/ru'])
  assert.deepEqual(toggleWelcomeInterest(['language', 'language/zh'], 'language/zh'), [])
})

test('every language child has a native name', () => {
  const language = INTEREST_OPTIONS.find(o => o.id === 'language')
  assert.deepEqual(Object.keys(NATIVE_LANGUAGE_NAMES).sort(), language.children.map(c => c.id).sort())
  assert.equal(NATIVE_LANGUAGE_NAMES['language/zh'], '中文')
  assert.equal(NATIVE_LANGUAGE_NAMES['language/cs'], 'Čeština')
})

const k = (key, extra = {}) => ({ key, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, targetKind: 'none', ...extra })
test('welcomeKey', () => {
  assert.deepEqual(welcomeKey(k('Enter'), 'interests', 0, 'idle'), { kind: 'primary' })
  assert.equal(welcomeKey(k('Enter', { isComposing: true }), 'interests', 0, 'idle'), null)
  assert.equal(welcomeKey(k('Enter', { targetKind: 'link' }), 'packs', 2, 'idle'), null)
  assert.equal(welcomeKey(k('Enter', { targetKind: 'otherButton' }), 'packs', 2, 'idle'), null)
  assert.equal(welcomeKey(k('Enter', { metaKey: true }), 'interests', 0, 'idle'), null)
  assert.deepEqual(welcomeKey(k('Escape'), 'packs', 2, 'idle'), { kind: 'later' })
  assert.equal(welcomeKey(k('Escape'), 'start', 1, 'idle'), null)
  assert.deepEqual(welcomeKey(k('ArrowLeft'), 'packs', 2, 'idle'), { kind: 'back' })
  assert.equal(welcomeKey(k('ArrowLeft'), 'interests', 0, 'idle'), null)
  assert.deepEqual(welcomeKey(k('2'), 'packs', 2, 'idle'), { kind: 'toggle', index: 1 })
  assert.equal(welcomeKey(k('3'), 'packs', 2, 'idle'), null)
  assert.equal(welcomeKey(k('1'), 'interests', 0, 'idle'), null)
  assert.equal(welcomeKey(k('0'), 'packs', 12, 'idle'), null)
  assert.equal(welcomeKey(k('Enter'), 'packs', 2, 'saving'), null)
  assert.equal(welcomeKey(k('ArrowLeft'), 'packs', 2, 'saving'), null)
})

test('carryChecks keeps old choices and checks new packs', () => {
  assert.deepEqual([...carryChecks(new Set(['a']), ['a', 'b'], ['a', 'b', 'c'])].sort(), ['a', 'c'])
  assert.deepEqual([...carryChecks(new Set(['a', 'b']), ['a', 'b'], ['b'])], ['b'])
})

test('demoProgress types by code point and stops at the end', () => {
  assert.equal(demoProgress('nihao', 0, 100), '')
  assert.equal(demoProgress('nihao', 250, 100), 'ni')
  assert.equal(demoProgress('nihao', 10_000, 100), 'nihao')
  assert.equal(demoProgress('привет', 300, 100), 'при')
})

test('welcomeKey ignores held keys, keys a menu handled and keys outside the tour', () => {
  assert.equal(welcomeKey(k('Enter', { repeat: true }), 'interests', 0, 'idle'), null)
  assert.equal(welcomeKey(k('Escape', { defaultPrevented: true }), 'interests', 0, 'idle'), null)
  assert.equal(welcomeKey(k('Escape', { targetKind: 'outside' }), 'interests', 0, 'idle'), null)
  assert.equal(welcomeKey(k('Enter', { targetKind: 'outside' }), 'packs', 2, 'idle'), null)
  assert.equal(welcomeKey(k('1', { targetKind: 'outside' }), 'packs', 2, 'idle'), null)
})

test('welcomeKey after a failed interests save: Enter retries, back and checks are locked', () => {
  assert.deepEqual(welcomeKey(k('Enter'), 'packs', 2, 'retry'), { kind: 'primary' })
  assert.deepEqual(welcomeKey(k('Escape'), 'packs', 2, 'retry'), { kind: 'later' })
  assert.equal(welcomeKey(k('ArrowLeft'), 'packs', 2, 'retry'), null)
  assert.equal(welcomeKey(k('1'), 'packs', 2, 'retry'), null)
  assert.equal(welcomeKey(k('Escape'), 'packs', 2, 'saving'), null)
})

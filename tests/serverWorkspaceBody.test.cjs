require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readWorkspaceChange } = require('../src/server/workspace.ts')

// The bodies of tests/fixtures/workspace-put.json, which the Go backend accepted and refused (TestMatchesTypeScript).
const { cases } = require('./fixtures/workspace-put.json')
const read = body => readWorkspaceChange(JSON.parse(body))

test('save bodies are accepted and refused as the Go backend did', () => {
  for (const c of cases) {
    const result = read(c.body)
    assert.equal('change' in result, c.accepted, c.name)
    if (!c.accepted) assert.ok(['invalidWorkspace', 'levelsConflict'].includes(result.refusal), c.name)
  }
})

const at = '2026-09-06'
const list = (id, extra = {}) => ({ id, name: id, createdAt: at, words: [{ display: 'a', input: 'a', annotation: '' }], records: [], ...extra })
const body = fields => JSON.stringify({ revision: 1, accountId: 'github:1', ...fields })

// The differences the owner decided to answer as the Go backend did (docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md).
test('a body is refused with invalidWorkspace for what the Go backend refused', () => {
  for (const fields of [
    { profileId: 'p', lists: [list('a')] },
    { packs: [] },
    { lists: null },
    { lists: [list('a')], packs: null },
    { devices: null },
    { lists: [list('a', { name: 'a\u0000b' })] },
    { lists: [list('a', { name: 'a\ud800b' })] },
    { devices: [{ id: 'd', name: 'x\udc00', layout: '' }] },
    { interests: ['a\u0000'] },
    { lists: [list('a', { words: [] })] },
    { lists: 'x' },
  ]) {
    assert.deepEqual(read(body(fields)), { refusal: 'invalidWorkspace' }, JSON.stringify(fields))
  }
  // A surrogate pair is a character like any other.
  assert.ok('change' in read(body({ lists: [list('a', { name: 'a😀' })] })))
})

test('interests sent as null are none', () => {
  assert.deepEqual(read(body({ interests: null })).change.interests, [])
  assert.deepEqual(read(body({ interests: ['programming'] })).change.interests, ['programming'])
})

test('a body of interests alone, or devices alone, is a change of those alone', () => {
  assert.deepEqual(read(body({ interests: ['programming'] })), { revision: 1, change: { interests: ['programming'] } })
  assert.deepEqual(Object.keys(read(body({ devices: [] })).change), ['devices'])
})

// An app before v0.97.0 sends lists of several levels with their packs; the Go backend took them, to be joined into one.
test('lists of several levels sent with packs are taken', () => {
  const packs = [{ id: 'p', name: 'P', createdAt: at }]
  const result = read(body({ packs, lists: [list('a', { packId: 'p', levels: ['初級', '文法'] }), list('b', { packId: 'p', levels: ['初級'] })] }))
  assert.ok('change' in result, JSON.stringify(result))
})

test('lists whose levels overlap are levelsConflict', () => {
  const packs = [{ id: 'p', name: 'P', createdAt: at }]
  const result = read(body({ packs, lists: [list('a', { packId: 'p', levels: ['初級'] }), list('a', { packId: 'p', levels: ['初級'] })] }))
  assert.ok(['levelsConflict', 'invalidWorkspace'].includes(result.refusal))
  const overlap = read(body({ packs, lists: [list('x', { packId: 'p' }), list('y', { packId: 'p', levels: ['x'] })] }))
  assert.deepEqual(overlap, { refusal: 'levelsConflict' })
})

// The levels so taken are still checked as saved data is: five at most, each a string within MAX_LEVEL.
test('lists of several levels are still held to the saved limits', () => {
  const { MAX_SAVED_LEVELS, MAX_LEVEL } = require('../src/core/wordLists.ts')
  const packs = [{ id: 'p', name: 'P', createdAt: at }]
  const levels = count => Array.from({ length: count }, (_, n) => `L${n}`)
  assert.ok('change' in read(body({ packs, lists: [list('a', { packId: 'p', levels: levels(MAX_SAVED_LEVELS) })] })))
  for (const bad of [levels(MAX_SAVED_LEVELS + 1), ['a', 'b'.repeat(MAX_LEVEL + 1)], ['a', 2]]) {
    assert.deepEqual(read(body({ packs, lists: [list('a', { packId: 'p', levels: bad })] })), { refusal: 'invalidWorkspace' }, JSON.stringify(bad))
  }
})

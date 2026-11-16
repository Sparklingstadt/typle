require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sharedPackFile } = require('../src/server/shares.ts')

// The files were written by the Go backend (workspace.Decode, then EncodePackFile) from the same saved rows, so a pack
// shared by either side is the same link's same file.
const { cases } = require('./fixtures/share-snapshots.json')

test('a shared pack is written from the saved row as the Go backend wrote it', () => {
  assert.ok(cases.length >= 4)
  for (const { name, saved, packId, file } of cases) assert.equal(sharedPackFile(saved, packId), file, name)
})

test('an account that has saved nothing has no pack to share', () => {
  assert.equal(sharedPackFile(null, 'pack-a'), null)
})

// A list saved with "writing": null has no writing mark, as the Go backend read it (writingOf); the owner decided to
// follow Go here (docs/superpowers/specs/2026-11-16-go-backend-to-ts-design.md).
test('a writing mark saved as null is read as none', () => {
  const at = '2026-10-01T00:00:00.000Z'
  const list = { id: 'l1', name: 'L', packId: 'pack-a', words: [{ display: 'a', input: 'a', annotation: '' }], records: [], createdAt: at }
  const row = lists => ({ lists: JSON.stringify(lists), packs: JSON.stringify([{ id: 'pack-a', name: 'A', createdAt: at }]), devices: '[]' })
  assert.equal(sharedPackFile(row([{ ...list, writing: null }]), 'pack-a'), sharedPackFile(row([list]), 'pack-a'))
})

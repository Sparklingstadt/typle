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

require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { practicePath, editPackPath, editListPath, packSettingsPath } = require('../src/lib/routes.ts')

test('links encode the id the same way everywhere', () => {
  assert.equal(practicePath('a b&c'), '/play?list=a%20b%26c')
  assert.equal(practicePath('a'), '/play?list=a')
  assert.equal(practicePath('a b', { review: 'weak' }), '/play?list=a%20b&review=weak')
  assert.equal(editPackPath('p/1'), '/edit?pack=p%2F1')
  assert.equal(editListPath('l?1'), '/edit?list=l%3F1')
  assert.equal(packSettingsPath('p 1'), '/packs/edit?pack=p%201')
})

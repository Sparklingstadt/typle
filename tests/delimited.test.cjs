require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { read, write } = require('./fixtures/delimited/cases.json')
const { encodeWordCsv, parseWordCsv } = require('../src/core/wordFormat.ts')

for (const { name, source, words, error } of read) {
  test(`reads: ${name}`, () => {
    if (words) return assert.deepEqual(parseWordCsv(source), words)
    assert.throws(() => parseWordCsv(source), thrown => {
      assert.equal(thrown.key, error.key)
      assert.equal(thrown.values.line, error.line)
      return true
    })
  })
}
for (const { name, words, csv } of write) {
  test(`writes: ${name}`, () => assert.equal(encodeWordCsv(words), csv))
}

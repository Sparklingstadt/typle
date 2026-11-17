require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { IMPORT_ACCEPT, encodeWordCsv, isWordCsv, parseWordCsv, wordFilename } = require('../src/lib/wordFormat.ts')
const wordCsvFilename = name => wordFilename(name, 'csv')

test('exported CSV round-trips Unicode, exact whitespace, duplicates, quotes and newlines', () => {
  const words = [
    { input: ' zi ', display: ' 字,日本 ', annotation: 'one\r\ntwo "quoted"\t' },
    { input: '=literal', display: '😀', annotation: '' },
    { input: '=literal', display: '😀', annotation: '' },
  ]
  const original = structuredClone(words)
  const csv = encodeWordCsv(words)
  assert.ok(csv.startsWith('\ufeffinput,display,annotation\r\n'))
  assert.deepEqual(parseWordCsv(csv), original)
  assert.deepEqual(words, original)
})

test('filenames retain readable names and remove path and reserved characters', () => {
  assert.equal(wordCsvFilename('中国語'), '中国語.csv')
  assert.equal(wordCsvFilename('../a:b\\c?'), '_a_b_c_.csv')
  assert.equal(wordCsvFilename('...'), 'word-list.csv')
  assert.equal(wordCsvFilename('CON'), '_CON.csv')
  assert.equal(wordCsvFilename('a'.repeat(200)).length, 84)
})

test('files are read by their extension, in any case, and other files are refused', () => {
  assert.equal(isWordCsv('words.csv'), true)
  assert.equal(isWordCsv('Words.CSV'), true)
  assert.equal(isWordCsv('words.tsv'), false)
  assert.equal(isWordCsv('words.txt'), false)
  assert.equal(IMPORT_ACCEPT, '.csv')
  assert.equal(wordFilename('中国語', 'typle-pack.json'), '中国語.typle-pack.json')
})

test('CSV round-trips explicit input types mixed with legacy words without adding defaults', () => {
  const words = [
    { input: 'ls', display: 'ls', annotation: '', input_type: 'command' },
    { input: 'return 1', display: 'return 1', annotation: 'code', input_type: 'code' },
    { input: 'neko', display: '猫', annotation: '', input_type: 'word' },
    { input: 'inu', display: '犬', annotation: '' },
  ]
  const csv = encodeWordCsv(words)
  assert.ok(csv.startsWith('\ufeffinput,display,annotation,input_type\r\n'))
  assert.deepEqual(parseWordCsv(csv), words)
  assert.throws(() => encodeWordCsv([{ ...words[0], input_type: null }]), { key: 'savedDataCorrupted' })
})

require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseWordCsv } = require('../src/core/wordFormat.ts')

test('CSV supports BOM, CRLF, reordered headers, escaped quotes and multiline annotations', () => {
  assert.deepEqual(parseWordCsv('\ufeffdisplay,input,annotation\r\n"日本,Japan",Japan,"one\r\ntwo ""quoted"""\r\n'), [
    { input: 'Japan', display: '日本,Japan', annotation: 'one\r\ntwo "quoted"' }
  ])
})
test('CSV allows missing annotation and blank lines, and a tab is plain text', () => {
  assert.deepEqual(parseWordCsv('input,display\n\nJapan,日本\n'), [{ input: 'Japan', display: '日本', annotation: '' }])
  assert.equal(parseWordCsv('input,display,annotation\nJapan,日本,a\tb')[0].annotation, 'a\tb')
})
test('invalid imports fail rather than partially importing', () => {
  for (const text of ['display\nx', 'input,display,input\na,b,c', 'input,display,other\na,b,c', 'input,display', 'input,display\na,', 'input,display\na,b,c', 'input,display\n"a,b', 'input,display\n"a"x,b', 'input,display\na"x,b']) {
    assert.throws(() => parseWordCsv(text), Error, text)
  }
  assert.throws(() => parseWordCsv('input,display\nok,yes\nno,'), { key: 'importFieldRequired', values: { line: 3 } })
  assert.throws(() => parseWordCsv('input,display\n' + 'a,b\n'.repeat(1001)), { key: 'importTooManyRows' })
  assert.throws(() => parseWordCsv('input,display\n' + 'a'.repeat(1001) + ',b'), { key: 'importFieldTooLong' })
  assert.throws(() => parseWordCsv('a'.repeat(1024 * 1024 + 1)), { key: 'importTooLarge' })
})

test('CSV preserves whitespace and duplicates through JSON save while rejecting empty records', () => {
  const { saveList, encodeLists, decodeLists } = require('../src/core/wordLists.ts')
  const words = parseWordCsv('display,input,anotation\r\n" 字 "," zi "," a\r\nb "\r\n字,zi,\r\n字,zi,')
  const list = { id: 'csv', name: 'CSV', createdAt: '2026-09-27', records: [], words }
  assert.deepEqual(decodeLists(encodeLists(saveList([], list, false)))[0].words, [
    { display: ' 字 ', input: ' zi ', annotation: ' a\r\nb ' },
    { display: '字', input: 'zi', annotation: '' },
    { display: '字', input: 'zi', annotation: '' },
  ])
  for (const row of [',,', '"","",""', '  ,  ,']) {
    assert.throws(() => parseWordCsv('display,input,annotation\na,b,\n' + row), { values: { line: 3 } })
  }
  assert.throws(() => parseWordCsv('display,input,annotation,anotation\na,b,c,d'), { key: 'importHeaderDuplicate' })
})

test('CSV accepts explicit word input types and leaves blank or absent types missing', () => {
  assert.deepEqual(parseWordCsv('input_type,display,input,annotation\ncommand,ls,ls,\ncode,return 1,return 1,\nword,猫,neko,\n,犬,inu,'), [
    { input: 'ls', display: 'ls', annotation: '', input_type: 'command' },
    { input: 'return 1', display: 'return 1', annotation: '', input_type: 'code' },
    { input: 'neko', display: '猫', annotation: '', input_type: 'word' },
    { input: 'inu', display: '犬', annotation: '' },
  ])
  for (const value of ['other', 'CODE', ' code ', 'null', 'true', '1']) {
    assert.throws(() => parseWordCsv(`input,display,input_type\nls,ls,${value}`), { key: 'importInputTypeInvalid', values: { line: 2 } })
  }
})

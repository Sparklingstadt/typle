require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { queryEscape, encodeValues, parseQuery, trimSpace, safeReturnTo } = require('../src/server/goUrl.ts')

// The pieces of Go's net/url and strings that the login's URLs and names are written and read with, so that a URL is
// the same text the Go backend sent (tests/fixtures/signin-answers.json checks them end to end).

test('queryEscape escapes as url.QueryEscape', () => {
  assert.equal(queryEscape('aZ09-_.~'), 'aZ09-_.~')
  assert.equal(queryEscape("a b+&=/?:*!'()"), 'a+b%2B%26%3D%2F%3F%3A%2A%21%27%28%29')
  assert.equal(queryEscape('ほ'), '%E3%81%BB')
  assert.equal(queryEscape(''), '')
})

test('encodeValues sorts the keys, as url.Values.Encode', () => {
  assert.equal(encodeValues({ state: 's t', client_id: 'c', code_challenge: 'x~' }), 'client_id=c&code_challenge=x~&state=s+t')
  assert.equal(encodeValues({}), '')
})

test('parseQuery reads as url.ParseQuery, dropping the pairs it cannot read', () => {
  const read = raw => Object.fromEntries(parseQuery(raw))
  assert.deepEqual(read('a=1&b=2&a=3'), { a: ['1', '3'], b: ['2'] })
  assert.deepEqual(read('a=x+y%20z&b'), { a: ['x y z'], b: [''] })
  assert.deepEqual(read('a=1;b=2&c=3'), { c: ['3'] })
  assert.deepEqual(read('a=%zz&b=%4&c=%41'), { c: ['A'] })
  assert.deepEqual(read('&&=v&'), { '': ['v'] })
  assert.deepEqual(read(''), {})
})

test('trimSpace trims what unicode.IsSpace calls space, and not a byte order mark', () => {
  assert.equal(trimSpace('　 \t\n\v\f\r\u0085 a b       '), 'a b')
  assert.equal(trimSpace('﻿a﻿'), '﻿a﻿')
  assert.equal(trimSpace('​'), '​')
})

test('safeReturnTo keeps a path of this site, and anything else is /home', () => {
  for (const path of ['/', '/lists', '/lists?x=1&y=<2>', '/a b', '/ほげ', '/a?q=%zz', '/a#b', '/a%20b', '/' + 'a'.repeat(1023)]) {
    assert.equal(safeReturnTo(path), path, path)
  }
  for (const path of ['', 'lists', '//evil.example', '/\\evil.example', 'https://evil.example', '/a\tb', '/a\u007fb', '/a%zz',
    '/a%4', '/a#%zz', '/' + 'a'.repeat(1024), '/' + 'ほ'.repeat(342)]) {
    assert.equal(safeReturnTo(path), '/home', path)
  }
})

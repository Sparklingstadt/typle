require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseGalleryQuery } = require('../src/server/gallery.ts')

// The cases of server/internal/web/gallery_test.go (TestGalleryQuery, TestGalleryInvalid), which the Go backend answered.
const read = query => parseGalleryQuery(new URL(`http://localhost/api/gallery${query}`))

test('the query is read as the Go backend read it', () => {
  assert.deepEqual(read('?q=%20abc%20&category=%E8%AA%9E%E5%AD%A6&sort=popular&page=2'), { text: 'abc', category: '語学', sort: 'popular', page: 2 })
  assert.deepEqual(read(''), { text: '', category: '', sort: 'new', page: 1 })
  assert.equal(read('?q=' + '%E3%81%82'.repeat(201)).text, 'あ'.repeat(200))
  assert.equal(read('?page=%2B2').page, 2)
  assert.equal(read('?page=007').page, 7)
  assert.equal(read('?q=a+b').text, 'a b')
  assert.equal(read('?q=%E3%80%80x%C2%85').text, 'x')
  assert.equal(read('?q=first&q=second').text, 'first')
  assert.deepEqual(read('?q=%zz'), { text: '', category: '', sort: 'new', page: 1 })
})

test('a bad query is refused', () => {
  for (const query of ['sort=old', 'page=0', 'page=abc', 'page=10001', 'page=-1', 'page=1.0', 'page=%201', 'q=%FF', 'q=a%00b', 'category=%C3', 'category=a%00b']) {
    assert.equal(read('?' + query), null, query)
  }
})

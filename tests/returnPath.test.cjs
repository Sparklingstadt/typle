require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { returnPath } = require('../src/lib/returnPath.ts')

// The page a login comes back to (?returnTo=, Auth.js's ?callbackUrl=) is a path of this site and nothing else:
// browsers drop tabs and line breaks from a URL and read "\" as "/", so a value that only looks like a path can go to
// another site.

test('a path of this site is kept, with its query and hash', () => {
  assert.equal(returnPath('/play'), '/play')
  assert.equal(returnPath('/play?list=a%20b&x=1#top'), '/play?list=a%20b&x=1#top')
  assert.equal(returnPath('/packs/catalog'), '/packs/catalog')
})

test('a value that leads to another site, or is no path, is home', () => {
  for (const value of ['/\t/evil.com', '/\n/evil.com', '/\r\\evil.com', '/.//evil', '//evil.com', '/\\evil.com',
    'https://evil.com', 'https://evil.com/play', 'javascript:alert(1)', 'play', '', ' /play', '/\u0000x']) {
    assert.equal(returnPath(value), '/home', JSON.stringify(value))
  }
  assert.equal(returnPath(undefined), '/home')
  assert.equal(returnPath(['/play', '/home']), '/home')
})

test('an absolute URL is never taken, whatever its origin', () => {
  for (const value of ['https://typle.example/play?x=1', 'https://evil.com/play', 'https://typle.example//evil.com', 'play']) {
    assert.equal(returnPath(value), '/home', value)
  }
})

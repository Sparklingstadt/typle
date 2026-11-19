require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { scriptPolicy } = require('../src/lib/contentSecurityPolicy.ts')

test('only scripts with the nonce, and the scripts they load, may run', () => {
  assert.equal(scriptPolicy('abc', false), "script-src 'self' 'nonce-abc' 'strict-dynamic'; object-src 'none'; base-uri 'self'")
})

test('development also allows eval for React', () => {
  assert.match(scriptPolicy('abc', true), /^script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval';/)
})

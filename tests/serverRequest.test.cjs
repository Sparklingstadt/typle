require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fromAppOrOrigin, jsonContent } = require('../src/server/request.ts')

const post = (body, headers = {}) => new Request('http://localhost/api/workspace', { method: 'POST', body: body === null ? undefined : body, headers })

test('only the app or the app\'s own origin may write', () => {
  const origin = 'https://typle.example'
  assert.equal(fromAppOrOrigin(post('', { Origin: origin }), origin), true)
  assert.equal(fromAppOrOrigin(post('', { Origin: 'https://evil.example' }), origin), false)
  assert.equal(fromAppOrOrigin(post(''), origin), false)
  assert.equal(fromAppOrOrigin(post('', { Authorization: 'Bearer x' }), origin), true)
})

test('the body must be declared as JSON, exactly', () => {
  assert.equal(jsonContent(post('', { 'Content-Type': 'application/json; charset=utf-8' })), true)
  assert.equal(jsonContent(post('', { 'Content-Type': ' application/json ' })), true)
  for (const type of ['text/plain', 'Application/JSON', '']) assert.equal(jsonContent(post('', type ? { 'Content-Type': type } : {})), false, type)
})

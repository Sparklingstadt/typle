require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fromAppOrOrigin, jsonContent, readStringFields } = require('../src/server/request.ts')

const post = (body, headers = {}) => new Request('http://localhost/api/gallery/reports', { method: 'POST', body: body === null ? undefined : body, headers })
const id = '0b6f2c1e-3d4a-4f5b-8c9d-0e1f2a3b4c5d'

// The bodies of server/internal/web/gallery_test.go (TestGalleryReport), which the Go backend refused.
test('the report body has exactly a non-empty id and reason', async () => {
  assert.deepEqual(await readStringFields(post(`{"id":"${id}","reason":"spam"}`), 4096, ['id', 'reason']), { id, reason: 'spam' })
  assert.deepEqual(await readStringFields(post(`{"id":"x","reason":"spam","id":"${id}"}`), 4096, ['id', 'reason']), { id, reason: 'spam' })
  for (const body of [`{"id":"${id}"}`, '{"reason":"spam"}', `{"id":"","reason":"spam"}`, `{"id":"${id}","reason":null}`,
    `{"id":"${id}","reason":"spam","x":1}`, '[]', 'x', '{"id":1,"reason":"spam"}', '', 'null', null]) {
    assert.equal(await readStringFields(post(body), 4096, ['id', 'reason']), null, String(body))
  }
  assert.equal(await readStringFields(post(`{"id":"${'a'.repeat(5000)}","reason":"spam"}`), 4096, ['id', 'reason']), null)
})

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

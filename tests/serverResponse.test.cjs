require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reply, refuse, methodNotAllowed, withoutBody } = require('../src/server/response.ts')

// The answers keep the Go backend's form byte for byte: its json.Encoder ends the body with a newline.
test('reply answers JSON that no cache keeps', async () => {
  const response = reply(200, { status: 'ok' })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '{"status":"ok"}\n')
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('vary'), 'Cookie')
})

test('refuse answers the error key', async () => {
  const response = refuse(503, 'databaseUnavailable')
  assert.equal(response.status, 503)
  assert.equal(await response.text(), '{"error":"databaseUnavailable"}\n')
})

test('methodNotAllowed lists the allowed methods', async () => {
  const response = methodNotAllowed(['GET', 'HEAD'])
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET, HEAD')
  assert.equal(await response.text(), '{"error":"methodNotAllowed"}\n')
})

test('withoutBody keeps the status and headers', async () => {
  const response = withoutBody(reply(503, { error: 'databaseUnavailable' }))
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(await response.text(), '')
})

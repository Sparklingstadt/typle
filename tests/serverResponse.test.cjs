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

const { forGallery, notForSearch } = require('../src/server/response.ts')

test('forGallery keeps the answer from search engines and caches', () => {
  const response = forGallery(refuse(400, 'invalidQuery'))
  assert.equal(response.headers.get('x-robots-tag'), 'noindex')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('vary'), 'Cookie')
})

test('notForSearch only keeps the answer from search engines', () => {
  const response = notForSearch(refuse(404, 'sharedPackNotFound'))
  assert.equal(response.headers.get('x-robots-tag'), 'noindex')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})

test('reportFailure logs the method, path and operation', () => {
  const { reportFailure } = require('../src/server/report.ts')
  const logged = []
  const original = console.error
  console.error = (...args) => logged.push(args.join(' '))
  try {
    reportFailure(new Request('http://localhost/api/gallery?q=x'), new Error('down'), 'gallery.read')
  } finally { console.error = original }
  assert.match(logged[0], /^GET \/api\/gallery: gallery\.read: .*down/)
})

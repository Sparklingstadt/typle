require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { answerShared, encodeSharedPack } = require('../src/server/shared.ts')

const fixtures = path.join(__dirname, 'fixtures/pack-file')
const files = fs.readdirSync(fixtures).filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8')).file)

/** The same value with the keys of every object in reverse order. */
const reversed = value => Array.isArray(value) ? value.map(reversed)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversed(item)]))
  : value

// The Go backend wrote a shared pack as PackFile.Encode: the file of the pack, whatever order and spacing the stored JSON
// has. tests/fixtures/pack-file holds what both write.
test('a shared pack is written as the pack file, byte for byte', () => {
  assert.ok(files.length >= 3)
  for (const file of files) {
    assert.equal(encodeSharedPack(file), file)
    assert.equal(encodeSharedPack(JSON.stringify(reversed(JSON.parse(file)))), file)
  }
})

test('empty labels and levels are left out, as the Go backend left them out', () => {
  const stored = { format: 'typle-pack', version: 1, pack: { name: 'n', description: '', category: '', tags: [] },
    lists: [{ name: 'l', levels: [], words: [{ display: 'a', input: 'a', annotation: '' }] }] }
  assert.equal(encodeSharedPack(JSON.stringify(stored)), JSON.stringify({ format: 'typle-pack', version: 1, pack: { name: 'n' },
    lists: [{ name: 'l', words: [{ display: 'a', input: 'a', annotation: '' }] }] }, null, 2) + '\n')
})

test('a writing mark with other fields is unreadable, as it was for the Go backend', () => {
  const stored = { format: 'typle-pack', version: 1, pack: { name: 'n' },
    lists: [{ name: 'l', writing: { language: 'ja', extra: 1 }, words: [] }] }
  assert.throws(() => encodeSharedPack(JSON.stringify(stored)))
})

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const owner = `test-shared-${randomUUID()}`
const db = url ? createPool(url) : null
after(async () => {
  if (!db) return
  await db.query('DELETE FROM typle_shared_packs WHERE owner_id = $1', [owner])
  await db.end()
})

async function insertShare(file, { hidden = null } = {}) {
  const id = randomUUID()
  await db.query(`INSERT INTO typle_shared_packs (id, owner_id, pack_id, data, hidden_at) VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [id, owner, `p-${id}`, file, hidden])
  return id
}

const get = id => new Request(`http://localhost/api/shared?id=${id}`)

test('the shared pack of a link', database, async () => {
  const id = await insertShare(files[0])
  const response = await answerShared(get(id), () => db)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), files[0])
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-robots-tag'), 'noindex')
  assert.equal(response.headers.get('vary'), null)
})

test('a hidden, missing or malformed link is not found', database, async () => {
  const hidden = await insertShare(files[0], { hidden: new Date() })
  for (const id of [hidden, randomUUID(), 'abc', '']) {
    const response = await answerShared(get(id), () => db)
    assert.equal(response.status, 404, id)
    assert.equal(await response.text(), '{"error":"sharedPackNotFound"}\n')
    assert.equal(response.headers.get('x-robots-tag'), 'noindex')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
})

test('503 when the database is down or not set', async () => {
  const down = createPool('postgres://user:pass@127.0.0.1:1/none')
  const original = console.error
  console.error = () => {}
  try {
    for (const open of [() => down, () => { throw new Error('DATABASE_URL is not set') }]) {
      const response = await answerShared(get(randomUUID()), open)
      assert.equal(response.status, 503)
      assert.equal(await response.text(), '{"error":"databaseUnavailable"}\n')
      assert.equal(response.headers.get('x-robots-tag'), 'noindex')
    }
  } finally {
    console.error = original
    await down.end()
  }
})

test('the route answers other methods with 405, not for search engines', async () => {
  const route = require('../src/app/api/shared/route.ts')
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await route[method]()
    assert.equal(response.status, 405, method)
    assert.equal(response.headers.get('allow'), 'GET, HEAD', method)
    assert.equal(response.headers.get('x-robots-tag'), 'noindex', method)
  }
})

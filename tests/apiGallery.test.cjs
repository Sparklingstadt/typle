require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { answerGallery, answerGalleryCategories } = require('../src/server/gallery.ts')

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`. Every row is made under
// one random owner, and every search is narrowed by a random mark, so the rows already there do not count.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const owner = `test-gallery-${randomUUID()}`
const db = url ? createPool(url) : null
after(async () => {
  if (!db) return
  await db.query('DELETE FROM typle_shared_packs WHERE owner_id = $1', [owner])
  await db.end()
})

let inserted = 0
/** Inserts a share whose pack has the given fields and lists of the given numbers of words. */
async function insertShare({ pack, words = [1], listed = new Date(), hidden = null, added = 0 }) {
  const lists = words.map((count, i) => ({ name: `list${i}`, words: Array.from({ length: count }, (_, j) => ({ display: `${j}`, input: `${j}`, annotation: '' })) }))
  const id = randomUUID()
  inserted++
  await db.query(`INSERT INTO typle_shared_packs (id, owner_id, pack_id, data, listed_at, hidden_at, add_count)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
  [id, owner, `p${inserted}`, JSON.stringify({ format: 'typle-pack', version: 1, pack, lists }), listed, hidden, added])
  return id
}

const minutesAgo = minutes => new Date(Date.now() - minutes * 60_000)
const get = path => new Request(`http://localhost${path}`)
const galleryOf = async query => {
  const response = await answerGallery(get(`/api/gallery?${query}`), () => db)
  assert.equal(response.status, 200)
  return JSON.parse(await response.text())
}

function expectGalleryHeaders(response) {
  assert.equal(response.headers.get('x-robots-tag'), 'noindex')
  assert.equal(response.headers.get('cache-control'), 'no-store')
}

test('the listed packs, newest first, with their counts', database, async () => {
  const mark = randomUUID()
  const old = await insertShare({ pack: { name: `old ${mark}`, description: 'd', category: 'c', tags: ['t1', 't2'] }, words: [2, 3], listed: minutesAgo(2) })
  const fresh = await insertShare({ pack: { name: `new ${mark}` }, listed: minutesAgo(1), added: 5 })
  await insertShare({ pack: { name: `unlisted ${mark}` }, listed: null })
  await insertShare({ pack: { name: `hidden ${mark}` }, hidden: new Date() })

  const { packs, more } = await galleryOf(`q=${mark}`)
  assert.equal(more, false)
  assert.deepEqual(packs.map(pack => pack.id), [fresh, old])
  assert.deepEqual(Object.keys(packs[1]), ['id', 'name', 'description', 'category', 'tags', 'lists', 'words', 'added', 'updatedAt'])
  assert.deepEqual({ ...packs[1], updatedAt: undefined }, { id: old, name: `old ${mark}`, description: 'd', category: 'c', tags: ['t1', 't2'], lists: 2, words: 5, added: 0, updatedAt: undefined })
  assert.match(packs[1].updatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  // A pack without labels has no keys for them.
  assert.deepEqual(Object.keys(packs[0]), ['id', 'name', 'lists', 'words', 'added', 'updatedAt'])

  assert.deepEqual((await galleryOf(`q=${mark}&sort=popular`)).packs.map(pack => pack.id), [fresh, old])
})

test('a page has 20 packs and says whether more follow', database, async () => {
  const mark = randomUUID()
  for (let i = 0; i < 21; i++) await insertShare({ pack: { name: `${mark} ${i}` }, listed: minutesAgo(30 - i) })
  const first = await galleryOf(`q=${mark}`)
  assert.equal(first.packs.length, 20)
  assert.equal(first.more, true)
  const second = await galleryOf(`q=${mark}&page=2`)
  assert.equal(second.packs.length, 1)
  assert.equal(second.more, false)
})

test('the search finds tags and descriptions, and % and _ are not wildcards', database, async () => {
  const mark = randomUUID()
  const tagged = await insertShare({ pack: { name: 'n', tags: [`tag${mark}`] } })
  const described = await insertShare({ pack: { name: 'n', description: `about ${mark}` } })
  const literal = await insertShare({ pack: { name: `100%_${mark}` } })
  await insertShare({ pack: { name: `100ab${mark}` } })
  assert.deepEqual(new Set((await galleryOf(`q=${mark}`)).packs.map(pack => pack.id)).size, 4)
  assert.deepEqual((await galleryOf(`q=tag${mark}`)).packs.map(pack => pack.id), [tagged])
  assert.deepEqual((await galleryOf(`q=about%20${mark}`)).packs.map(pack => pack.id), [described])
  assert.deepEqual((await galleryOf(`q=100%25_${mark}`)).packs.map(pack => pack.id), [literal])
})

test('a category narrows the gallery to it', database, async () => {
  const mark = randomUUID()
  const inCategory = await insertShare({ pack: { name: mark, category: `語学${mark}` } })
  await insertShare({ pack: { name: mark, category: 'other' } })
  assert.deepEqual((await galleryOf(`q=${mark}&category=${encodeURIComponent(`語学${mark}`)}`)).packs.map(pack => pack.id), [inCategory])
})

test('the categories are counted, the most first, without unlisted, hidden or empty ones', database, async () => {
  const mark = randomUUID()
  const many = `多い${mark}`, few = `少ない${mark}`, unlisted = `未掲載${mark}`, hidden = `非公開${mark}`
  await insertShare({ pack: { name: 'n', category: many } })
  await insertShare({ pack: { name: 'n', category: many } })
  await insertShare({ pack: { name: 'n', category: few } })
  await insertShare({ pack: { name: 'n', category: unlisted }, listed: null })
  await insertShare({ pack: { name: 'n', category: hidden }, hidden: new Date() })
  await insertShare({ pack: { name: 'n', category: '' } })

  const response = await answerGalleryCategories(get('/api/gallery/categories'), () => db)
  expectGalleryHeaders(response)
  const { categories } = JSON.parse(await response.text())
  const names = categories.map(category => category.name)
  assert.deepEqual(categories.filter(category => category.name.endsWith(mark)), [{ name: many, count: 2 }, { name: few, count: 1 }])
  assert.ok(!names.includes(''))
  const collator = new Intl.Collator('ja')
  for (let i = 1; i < categories.length; i++) {
    const [a, b] = [categories[i - 1], categories[i]]
    assert.ok(a.count > b.count || (a.count === b.count && collator.compare(a.name, b.name) <= 0), `${a.name} before ${b.name}`)
  }
})

test('a bad query is refused with the gallery headers', async () => {
  const response = await answerGallery(get('/api/gallery?page=0'), () => { throw new Error('not opened') })
  assert.equal(response.status, 400)
  assert.equal(await response.text(), '{"error":"invalidQuery"}\n')
  expectGalleryHeaders(response)
})

test('503 when the database is down or not set', async () => {
  const down = createPool('postgres://user:pass@127.0.0.1:1/none')
  const original = console.error
  console.error = () => {}
  try {
    for (const open of [() => down, () => { throw new Error('DATABASE_URL is not set') }]) {
      for (const answer of [answerGallery, answerGalleryCategories]) {
        const response = await answer(get('/api/gallery'), open)
        assert.equal(response.status, 503)
        assert.equal(await response.text(), '{"error":"databaseUnavailable"}\n')
        expectGalleryHeaders(response)
      }
    }
  } finally {
    console.error = original
    await down.end()
  }
})

test('the routes answer other methods with 405 and the gallery headers', async () => {
  for (const route of [require('../src/app/api/gallery/route.ts'), require('../src/app/api/gallery/categories/route.ts')]) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await route[method]()
      assert.equal(response.status, 405, method)
      assert.equal(response.headers.get('allow'), 'GET, HEAD', method)
      expectGalleryHeaders(response)
    }
  }
})

require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac, hkdfSync, randomBytes } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { answerAdmin, isAdmin, setHidden } = require('../src/server/admin.ts')
const { readLoginSettings } = require('../src/server/settings.ts')

// /api/admin/* against a real database, as npm run verify runs it: `TYPLE_TEST_DATABASE_URL=… npm test`. The answers are
// the Go backend's (tests/fixtures/admin-answers.json, made by the Go backend, removed in v2.47.0, on the same kind of seed), with the
// counts over the whole database and the rows other tests leave left out.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const fixture = require('./fixtures/admin-answers.json')
const settings = readLoginSettings({ AUTH_SECRET: fixture.secret, AUTH_URL: fixture.origin })
const open = () => db
const tokens = []
after(async () => {
  if (!db) return
  for (const token of tokens) {
    const owners = [`ts-test:${token}`, `ts-test:${token}b`]
    await db.query('DELETE FROM typle_gallery_reports WHERE share_id IN (SELECT id FROM typle_shared_packs WHERE owner_id = ANY($1))', [owners])
    await db.query('DELETE FROM typle_shared_packs WHERE owner_id = ANY($1)', [owners])
    await db.query('DELETE FROM typle_workspaces WHERE owner_id = ANY($1)', [owners])
    await db.query('DELETE FROM typle_admins WHERE email LIKE $1', [`%${token}%`])
  }
  await db.end()
})

const adminKey = Buffer.from(hkdfSync('sha256', fixture.secret, Buffer.alloc(0), 'typle admin v2', 32))
/** The administrator's cookie value as Go's SealAdmin writes it, issued offset seconds from now. */
function sealAdmin(email, sub, offset = 0) {
  const iat = Math.floor(Date.now() / 1000) + offset
  const payload = Buffer.from(JSON.stringify({ email, sub, iat, exp: iat + 12 * 3600 })).toString('base64url')
  return `${payload}.${createHmac('sha256', adminKey).update(payload).digest('base64url')}`
}

/**
 * Seeds the fixture's rows under a token of this run, once (an FFPF ID sub is bound to one row only, so the tests share
 * them), and returns the token, the owners and the shares' ids by key. The tests that use it run in order.
 */
let seeded
const seed = () => (seeded ??= seedRows())
async function seedRows() {
  const token = randomBytes(6).toString('hex')
  tokens.push(token)
  const owners = { '<owner>': `ts-test:${token}`, '<other>': `ts-test:${token}b` }
  for (const [key, w] of Object.entries(fixture.seed.workspaces)) {
    await db.query(`INSERT INTO typle_workspaces (owner_id, lists, packs, devices, revision, updated_at)
      VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, now() + make_interval(secs => $6))`, [owners[key], w.lists, w.packs, w.devices, w.revision, w.updatedOffset])
  }
  const ids = {}
  for (const [n, share] of fixture.seed.shares.entries()) {
    const { rows } = await db.query(`INSERT INTO typle_shared_packs (id, owner_id, pack_id, data, add_count, listed_at, hidden_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4,
        CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(secs => $5::int) END,
        CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(secs => $6::int) END,
        now() + make_interval(secs => $7)) RETURNING id::text`,
    [owners['<owner>'], `p${n}`, JSON.stringify({ pack: { name: share.name, category: share.category } }), share.added, share.listedOffset, share.hiddenOffset, share.updatedOffset])
    ids[share.key] = rows[0].id
  }
  // One statement each, as Go inserted them: the reports at the same offset are told apart by their transaction's now().
  for (const report of fixture.seed.reports) {
    await db.query(`INSERT INTO typle_gallery_reports (id, share_id, reason, created_at)
      VALUES (gen_random_uuid(), $1::uuid, $2, now() + make_interval(secs => $3))`, [ids[report.share], report.reason, report.atOffset])
  }
  for (const admin of fixture.seed.admins) {
    await db.query('INSERT INTO typle_admins (email, ffpf_sub) VALUES ($1, $2)', [admin.email.replace('<t>', token), admin.sub])
  }
  return { token, owners, ids }
}

/** The answer's body as the fixture keeps it: the seeded rows only, with placeholders for the token, owners, ids and times. */
function normalize(value, { token, owners, ids }) {
  const names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, `<${key}>`]))
  const ownerKeys = Object.fromEntries(Object.entries(owners).map(([key, id]) => [id, key]))
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out = {}
      for (const [key, item] of Object.entries(v)) {
        if (['workspaces', 'activeDay', 'activeWeek', 'activeMonth', 'sharedPacks', 'total'].includes(key)) {
          out[key] = '<count>'
        } else if (['recentShares', 'users', 'packs', 'admins'].includes(key) && Array.isArray(item)) {
          out[key] = item.filter(row => !(key === 'packs' && !(row.id in names)) &&
            !(typeof row.ownerId === 'string' && !(row.ownerId in ownerKeys)) &&
            !(typeof row.email === 'string' && !row.email.includes(token))).map(walk)
        } else {
          out[key] = walk(item)
        }
      }
      return out
    }
    if (typeof v === 'string') return names[v] ?? ownerKeys[v] ?? v.replaceAll(token, '<t>')
    return v
  }
  const text = JSON.stringify(walk(value)).replace(/"\d{4}-\d\d-\d\dT[^"]+"/g, '"<time>"')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  return JSON.parse(text)
}

const routes = {
  '/api/admin/dashboard': 'dashboard', '/api/admin/users': 'users', '/api/admin/gallery': 'gallery',
  '/api/admin/gallery/hide': 'hide', '/api/admin/gallery/unhide': 'unhide',
}
const served = { dashboard: ['GET', 'HEAD'], users: ['GET', 'HEAD'], gallery: ['GET', 'HEAD'], hide: ['POST'], unhide: ['POST'] }

/** Sends a request of the fixture as the Route Handler file would: an unserved method is 405, HEAD the GET answer. */
async function send(q, run) {
  const cookieOf = {
    admin: () => sealAdmin(`admin-${run.token}@example.com`, 'cadmin'),
    adminUpper: () => sealAdmin(`ADMIN-${run.token}@Example.com`, 'cadmin'),
    otherSub: () => sealAdmin(`admin-${run.token}@example.com`, 'cother'),
    bound: () => sealAdmin(`bound-${run.token}@example.com`, 'cadmin'),
    nobody: () => sealAdmin(`nobody-${run.token}@example.com`, 'cadmin'),
    expired: () => sealAdmin(`admin-${run.token}@example.com`, 'cadmin', -13 * 3600),
  }
  const [path, query = ''] = q.path.split('?')
  const name = routes[path]
  const headers = {}
  if (q.cookie) headers.Cookie = `typle-admin=${cookieOf[q.cookie]()}`
  if (q.origin) headers.Origin = q.origin
  if (q.contentType) headers['Content-Type'] = q.contentType
  let body = q.body || undefined
  for (const [key, id] of Object.entries(run.ids)) body = body?.replaceAll(`<${key}>`, id)
  if (!served[name].includes(q.method)) {
    const { methodNotAllowed } = require('../src/server/response.ts')
    return methodNotAllowed(served[name])
  }
  const method = q.method === 'HEAD' ? 'GET' : q.method
  const request = new Request(`${fixture.origin}${path}${query ? `?${query}` : ''}`, { method, headers, body })
  return answerAdmin(name, request, open, () => settings)
}

test('the Route Handlers answer /api/admin/* as the Go backend did', database, async () => {
  const run = await seed()
  for (const [n, q] of fixture.requests.entries()) {
    const want = fixture.answers[n]
    const response = await send(q, run)
    assert.equal(response.status, want.status, q.note)
    assert.equal(response.headers.get('Allow') ?? '', want.allow ?? '', q.note)
    assert.deepEqual(response.headers.getSetCookie(), want.setCookie, q.note)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store', q.note)
    assert.equal(response.headers.get('Vary'), 'Cookie', q.note)
    const text = await response.text()
    if (q.method === 'HEAD' || want.body === null) {
      if (want.body === null) assert.equal(text, '', q.note)
      continue
    }
    assert.ok(text.endsWith('\n'), q.note)
    assert.deepEqual(normalize(JSON.parse(text), run), want.body, q.note)
  }
})

// The keys in the order of Go's structs (store.AdminOverview, AdminUser, AdminGalleryPack, web.adminUsersAnswer).
test('the answers keep the order of the Go backend\'s keys', database, async () => {
  const run = await seed()
  const cookie = `typle-admin=${sealAdmin(`admin-${run.token}@example.com`, 'cadmin')}`
  const get = async name => JSON.parse(await (await answerAdmin(name, new Request(`${fixture.origin}/api/admin/${name}`, { headers: { Cookie: cookie } }), open, () => settings)).text())
  const dashboard = await get('dashboard')
  assert.deepEqual(Object.keys(dashboard), ['admin', 'overview'])
  assert.deepEqual(Object.keys(dashboard.admin), ['email', 'sub'])
  assert.deepEqual(Object.keys(dashboard.overview), ['workspaces', 'activeDay', 'activeWeek', 'activeMonth', 'sharedPacks', 'recentShares', 'admins'])
  assert.deepEqual(Object.keys(dashboard.overview.recentShares[0]), ['id', 'ownerId', 'name', 'updatedAt'])
  assert.deepEqual(Object.keys(dashboard.overview.admins[0]), ['email', 'ffpfSub', 'createdAt', 'lastSeenAt'])
  const users = await get('users')
  assert.deepEqual(Object.keys(users), ['page', 'pageSize', 'total', 'users'])
  assert.deepEqual(Object.keys(users.users[0]), ['ownerId', 'lists', 'packs', 'devices', 'shares', 'revision', 'updatedAt'])
  const { packs } = await get('gallery')
  const many = packs.find(pack => pack.id === run.ids.many)
  assert.deepEqual(Object.keys(many), ['id', 'name', 'category', 'added', 'listedAt', 'hiddenAt', 'reports', 'reasons'])
  assert.deepEqual(Object.keys(many.reasons), ['inappropriate', 'spam'])
  assert.deepEqual(Object.keys(packs.find(pack => pack.id === run.ids.newer)), ['id', 'name', 'added', 'listedAt', 'hiddenAt', 'reports', 'reasons'])
  assert.match(many.listedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
})

// Go's TestOverview: the counts are over every account, and one more saved, active and sharing account adds one to each.
test('the dashboard counts every account', database, async () => {
  const run = await seed()
  const cookie = `typle-admin=${sealAdmin(`admin-${run.token}@example.com`, 'cadmin')}`
  const read = async () => JSON.parse(await (await answerAdmin('dashboard', new Request(`${fixture.origin}/api/admin/dashboard`, { headers: { Cookie: cookie } }), open, () => settings)).text()).overview
  const total = async () => JSON.parse(await (await answerAdmin('users', new Request(`${fixture.origin}/api/admin/users`, { headers: { Cookie: cookie } }), open, () => settings)).text()).total
  const before = await read()
  const owner = `ts-test:${run.token}c`
  tokens.push(`${run.token}c`)
  await db.query(`INSERT INTO typle_workspaces (owner_id, lists, devices) VALUES ($1, '[]', '[]')`, [owner])
  await db.query(`INSERT INTO typle_shared_packs (id, owner_id, pack_id, data) VALUES (gen_random_uuid(), $1, 'p', '{"pack":{"name":"W"}}')`, [owner])
  const now = await read()
  for (const key of ['workspaces', 'activeDay', 'activeWeek', 'activeMonth', 'sharedPacks']) assert.equal(now[key], before[key] + 1, key)
  assert.equal(await total(), now.workspaces)
})

// Go's TestAdmin and TestSetHidden.
test('an administrator binds the sub of the first sign-in, and an empty email or sub is nobody', database, async () => {
  const token = randomBytes(6).toString('hex')
  tokens.push(token)
  const email = `first-${token}@example.com`
  assert.equal(await isAdmin(db, email, 'sub1'), false)
  await db.query('INSERT INTO typle_admins (email) VALUES ($1)', [email])
  for (const [e, s] of [[email, ''], ['', 'sub1'], ['', '']]) assert.equal(await isAdmin(db, e, s), false)
  assert.equal((await db.query('SELECT ffpf_sub FROM typle_admins WHERE email = $1', [email])).rows[0].ffpf_sub, null)
  assert.equal(await isAdmin(db, email.toUpperCase(), 'sub1'), true)
  const { rows: [row] } = await db.query('SELECT ffpf_sub, last_seen_at FROM typle_admins WHERE email = $1', [email])
  assert.equal(row.ffpf_sub, 'sub1')
  assert.ok(row.last_seen_at)
  assert.equal(await isAdmin(db, email, 'sub2'), false)
  assert.equal(await isAdmin(db, email, 'sub1'), true)
})

test('hiding keeps the first time and leaves the listing, and showing again clears it', database, async () => {
  const run = await seed()
  const read = async () => (await db.query('SELECT listed_at, hidden_at FROM typle_shared_packs WHERE id = $1', [run.ids.hidden])).rows[0]
  const first = await read()
  assert.equal(await setHidden(db, run.ids.hidden, true), true)
  assert.deepEqual(await read(), first)
  assert.equal(await setHidden(db, run.ids.hidden, false), true)
  assert.deepEqual(await read(), { listed_at: first.listed_at, hidden_at: null })
  assert.equal(await setHidden(db, run.ids.hidden.toUpperCase(), true), true)
  assert.equal(await setHidden(db, 'nope', true), false)
})

test('without the login settings or the database, the answer is 503', async () => {
  const request = new Request(`${fixture.origin}/api/admin/dashboard`)
  const unavailable = await answerAdmin('dashboard', request, open, () => null)
  assert.equal(unavailable.status, 503)
  assert.equal(await unavailable.text(), '{"error":"authUnavailable"}\n')
  const closed = await answerAdmin('dashboard', request, () => { throw new Error('no database') }, () => settings)
  assert.equal(closed.status, 503)
  assert.equal(await closed.text(), '{"error":"databaseUnavailable"}\n')
})

test('over HTTPS the cookie is __Host- and its removal is Secure', database, async () => {
  const secure = readLoginSettings({ AUTH_SECRET: fixture.secret, AUTH_URL: 'https://typle.example' })
  const token = randomBytes(6).toString('hex')
  tokens.push(token)
  const value = sealAdmin(`gone-${token}@example.com`, 'cadmin')
  const plain = await answerAdmin('dashboard', new Request('https://typle.example/api/admin/dashboard', { headers: { Cookie: `typle-admin=${value}` } }), open, () => secure)
  assert.equal(plain.status, 401)
  const refused = await answerAdmin('dashboard', new Request('https://typle.example/api/admin/dashboard', { headers: { Cookie: `__Host-typle-admin=${value}` } }), open, () => secure)
  assert.equal(refused.status, 403)
  assert.deepEqual(refused.headers.getSetCookie(), ['__Host-typle-admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict'])
})

// Go's TestAdminGallery: with as many reports at the same latest time, the share listed last comes first, and one never
// listed (only hidden) comes after the listed ones.
test('equal reports are ordered by listed_at, the newest first and the never listed last', database, async () => {
  const run = await seed()
  const owner = `ts-test:${run.token}b`
  const at = new Date(Date.now() + 86_400_000)
  const ids = []
  for (const [n, listed] of [[-2, null], [-1, -5], [0, -1]]) {
    const { rows } = await db.query(`INSERT INTO typle_shared_packs (id, owner_id, pack_id, data, listed_at, hidden_at)
      VALUES (gen_random_uuid(), $1, $2, '{"pack":{"name":"T"}}', CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(hours => $3::int) END,
        CASE WHEN $3::int IS NULL THEN now() END) RETURNING id::text`, [owner, `tie${n}`, listed])
    ids.push(rows[0].id)
    for (const reason of ['spam', 'other', 'inappropriate', 'personalInfo', 'spam']) {
      await db.query(`INSERT INTO typle_gallery_reports (id, share_id, reason, created_at) VALUES (gen_random_uuid(), $1, $2, $3)`, [rows[0].id, reason, at])
    }
  }
  const cookie = `typle-admin=${sealAdmin(`admin-${run.token}@example.com`, 'cadmin')}`
  const { packs } = JSON.parse(await (await answerAdmin('gallery', new Request(`${fixture.origin}/api/admin/gallery`, { headers: { Cookie: cookie } }), open, () => settings)).text())
  assert.deepEqual(packs.filter(pack => ids.includes(pack.id)).map(pack => pack.id), [ids[2], ids[1], ids[0]])
  assert.deepEqual(packs.find(pack => pack.id === ids[2]).reasons, { inappropriate: 1, other: 1, personalInfo: 1, spam: 2 })
})

// An app's token never stands in for the app's own Origin here: the dashboard is only used from the app's pages.
test('a hide with an app token and no Origin is refused', database, async () => {
  const run = await seed()
  const cookie = `typle-admin=${sealAdmin(`admin-${run.token}@example.com`, 'cadmin')}`
  const response = await answerAdmin('hide', new Request(`${fixture.origin}/api/admin/gallery/hide`, {
    method: 'POST', body: JSON.stringify({ id: run.ids.newer }),
    headers: { Cookie: cookie, Authorization: 'Bearer x', 'Content-Type': 'application/json' },
  }), open, () => settings)
  assert.equal(response.status, 403)
  assert.equal(await response.text(), '{"error":"forbiddenRequest"}\n')
})

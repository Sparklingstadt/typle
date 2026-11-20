require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, scrypt } = require('node:crypto')
const { createPool } = require('../src/server/database.ts')
const { createUser } = require('../src/server/users.ts')
const { hashPassword } = require('../src/server/password.ts')
const { countHit, LIMITS } = require('../src/server/limits.ts')
const { authorizePassword, checkPassword } = require('../src/server/passwordLogin.ts')
const { openSession, sealSession, newSession } = require('../src/server/session.ts')

// Runs against a real database, as npm run verify does: `TYPLE_TEST_DATABASE_URL=… npm test`.
const url = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: url ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
const db = url ? createPool(url) : null
const prefix = `t${randomUUID().slice(0, 8).replace(/-/g, '')}`
after(async () => {
  if (!db) return
  await db.query('DELETE FROM typle_users WHERE login_id LIKE $1', [`${prefix}%`])
  await db.query('DELETE FROM typle_auth_limits WHERE key LIKE $1', [`%${prefix}%`])
  await db.end()
})

const PASSWORD = 'correct horse battery'

/** An account named prefix+name with PASSWORD. */
async function account(name) {
  const loginId = `${prefix}${name}`
  const { id } = await createUser(db, { loginId, email: `${loginId}@example.com`, passwordHash: await hashPassword(PASSWORD), locale: 'ja' })
  return { id, loginId }
}

/** The real scrypt, counting its runs. */
function counted() {
  const derive = (password, salt, keyLength, options) => {
    derive.runs++
    return new Promise((resolve, reject) => scrypt(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key))))
  }
  derive.runs = 0
  return derive
}

/** The real scrypt, counting all its runs and, as real, those against a stored hash rather than the dummy (salt all ones). */
function realRuns() {
  const inner = counted()
  const wrapped = (password, salt, keyLength, options) => {
    if (!salt.equals(Buffer.alloc(16, 1))) wrapped.real++
    wrapped.runs++
    return inner(password, salt, keyLength, options)
  }
  wrapped.real = 0
  wrapped.runs = 0
  return wrapped
}

const ip = name => `ip-${prefix}-${name}`
const failures = async key => (await db.query('SELECT count FROM typle_auth_limits WHERE key = $1', [key])).rows[0]?.count ?? 0

test('the right ID and password sign in as password:<uuid>, the ID in any case and with spaces', database, async () => {
  const { id, loginId } = await account('ok')
  const derive = counted()
  const user = await authorizePassword(db, { loginId: `  ${loginId.toUpperCase()} `, password: PASSWORD }, ip('ok'), undefined, derive)
  assert.deepEqual(user, { id: `password:${id}`, name: loginId, image: '' })
  assert.match(user.id, /^password:[0-9a-f-]{36}$/)
  assert.equal(derive.runs, 1)
})

test('a wrong password and an unknown ID are both refused after one scrypt, and counted', database, async () => {
  const { loginId } = await account('wrong')
  const wrong = counted()
  assert.equal(await authorizePassword(db, { loginId, password: 'not the password' }, ip('wrong'), undefined, wrong), null)
  assert.equal(wrong.runs, 1)
  assert.equal(await failures(LIMITS.loginFailId(loginId).key), 1)
  assert.equal(await failures(LIMITS.loginFailIp(ip('wrong')).key), 1)

  const unknown = counted()
  assert.equal(await authorizePassword(db, { loginId: `${prefix}nobody`, password: PASSWORD }, ip('wrong'), undefined, unknown), null)
  assert.equal(unknown.runs, 1)
  assert.equal(await failures(LIMITS.loginFailId(`${prefix}nobody`).key), 1)
  assert.equal(await failures(LIMITS.loginFailIp(ip('wrong')).key), 2)
})

test('after five failures even the right password is refused, still after one scrypt', database, async () => {
  const { loginId } = await account('five')
  for (let i = 0; i < 5; i++) assert.equal(await authorizePassword(db, { loginId, password: `wrong ${i} password` }, ip(`five${i}`)), null)
  const derive = counted()
  assert.equal(await authorizePassword(db, { loginId: loginId.toUpperCase(), password: PASSWORD }, ip('five-ok'), undefined, derive), null)
  assert.equal(derive.runs, 1)
})

test('a blocked IP is refused even with the right password, without scrypt', database, async () => {
  const { loginId } = await account('ipblock')
  for (let i = 0; i < 30; i++) await countHit(db, LIMITS.loginFailIp(ip('blocked')))
  for (const id of [loginId, `${prefix}ipnobody`]) {
    const derive = realRuns()
    assert.equal(await authorizePassword(db, { loginId: id, password: PASSWORD }, ip('blocked'), undefined, derive), null)
    // A blocked IP tells nothing about the ID, so no scrypt is run to hide it.
    assert.equal(derive.runs, 0)
    // A blocked IP cannot lock accounts: the ID's count is left alone.
    assert.equal(await failures(LIMITS.loginFailId(id).key), 0)
  }
  assert.notEqual(await authorizePassword(db, { loginId, password: PASSWORD }, ip('other')), null)
})

test('an attempt on a blocked ID leaves the IP\'s count as it was', database, async () => {
  const { loginId } = await account('idblock')
  for (let i = 0; i < 5; i++) await authorizePassword(db, { loginId, password: `wrong ${i} password` }, ip(`idblock${i}`))
  const derive = realRuns()
  assert.equal(await authorizePassword(db, { loginId, password: PASSWORD }, ip('idblock-late'), undefined, derive), null)
  assert.equal(derive.runs, 1)
  assert.equal(derive.real, 0)
  assert.equal(await failures(LIMITS.loginFailIp(ip('idblock-late')).key), 0)
})

test('signing in forgets the ID\'s failures', database, async () => {
  const { loginId } = await account('clear')
  for (let i = 0; i < 3; i++) await authorizePassword(db, { loginId, password: 'wrong password' }, ip('clear'))
  assert.equal(await failures(LIMITS.loginFailId(loginId).key), 3)
  assert.equal(await failures(LIMITS.loginFailIp(ip('clear')).key), 3)
  assert.notEqual(await authorizePassword(db, { loginId, password: PASSWORD }, ip('clear')), null)
  assert.equal(await failures(LIMITS.loginFailId(loginId).key), 0)
  // The attempt reserved before scrypt is taken back from the IP's count.
  assert.equal(await failures(LIMITS.loginFailIp(ip('clear')).key), 3)
})

test('attempts sent together get no more than five guesses at the password', database, async () => {
  const { loginId } = await account('parallel')
  const derive = realRuns()
  const answers = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    authorizePassword(db, { loginId, password: `wrong ${i} password` }, ip(`parallel${i}`), undefined, derive)))
  assert.deepEqual(answers, Array(10).fill(null))
  assert.equal(derive.real, 5)
  const late = realRuns()
  assert.equal(await authorizePassword(db, { loginId, password: PASSWORD }, ip('parallel-ok'), undefined, late), null)
  assert.equal(late.real, 0)
})

test('the right password sent together with wrong ones cannot get past the block', database, async () => {
  const { loginId } = await account('race')
  for (let i = 0; i < 4; i++) await authorizePassword(db, { loginId, password: `wrong ${i} password` }, ip('race'))
  // One slot is left: of a wrong and a right password sent together, at most one is checked against the hash.
  const derive = realRuns()
  await Promise.all([
    authorizePassword(db, { loginId, password: 'wrong 9 password' }, ip('race'), undefined, derive),
    authorizePassword(db, { loginId, password: PASSWORD }, ip('race'), undefined, derive),
  ])
  assert.equal(derive.real, 1)
})

test('credentials of the wrong shape are refused without a lookup', async () => {
  const derive = counted()
  const unused = { query: () => { throw new Error('no query expected') } }
  for (const credentials of [{}, { loginId: 'alice_1' }, { password: PASSWORD }, { loginId: ['alice_1'], password: PASSWORD },
    { loginId: 'alice_1', password: 12345678901 }, { loginId: 'a', password: PASSWORD }, { loginId: 'bad id!', password: PASSWORD },
    { loginId: 'alice_1', password: 'x'.repeat(129) }]) {
    assert.equal(await authorizePassword(unused, credentials, 'ip', undefined, derive), null)
  }
  assert.equal(derive.runs, 0)
})

test('a session for a password account opens', () => {
  const key = Buffer.alloc(32, 7)
  const uuid = randomUUID()
  const sealed = sealSession(key, newSession(`password:${uuid}`, 'alice_1', ''))
  assert.equal(openSession(key, sealed).sub, `password:${uuid}`)
  for (const sub of [`password:${uuid.toUpperCase()}`, 'password:', 'password:abc', `password:${uuid}x`]) {
    assert.equal(openSession(key, sealSession(key, newSession(sub, 'alice_1', ''))), null, sub)
  }
})

test('the password provider\'s callback, where next-auth/react posts the credentials, is answered', () => {
  const { authPathKnown } = require('../src/server/authOptions.ts')
  assert.equal(authPathKnown('/api/auth/callback/password', ['github', 'password']), true)
  assert.equal(authPathKnown('/api/auth/signin/password', ['github', 'password']), true)
})

test('checkPassword tells a refusal by the limits from a wrong password', database, async () => {
  const { loginId } = await account('why')
  assert.deepEqual(await checkPassword(db, { loginId, password: 'not the password' }, ip('why')), { refused: 'wrong' })
  for (let i = 0; i < 4; i++) await authorizePassword(db, { loginId, password: `wrong ${i} password` }, ip(`why${i}`))
  assert.deepEqual(await checkPassword(db, { loginId, password: PASSWORD }, ip('why-late')), { refused: 'limited' })
  assert.deepEqual(await checkPassword(db, { loginId: `${prefix}whyx`, password: PASSWORD }, ip('why-other')), { refused: 'wrong' })
  for (let i = 0; i < 30; i++) await countHit(db, LIMITS.loginFailIp(ip('why-blocked')))
  assert.deepEqual(await checkPassword(db, { loginId: `${prefix}whyx`, password: PASSWORD }, ip('why-blocked')), { refused: 'limited' })
  const { account: signed } = await checkPassword(db, { loginId: (await account('why2')).loginId, password: PASSWORD }, ip('why2'))
  assert.match(signed.id, /^password:/)
})

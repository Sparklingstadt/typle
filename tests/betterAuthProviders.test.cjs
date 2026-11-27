require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { githubUser } = require('../src/server/authUser.ts')
const { sidUser, sidAccountInfo, SID_PROVIDER_ID } = require('../src/server/sidLogin.ts')
const { authPathAllowed } = require('../src/server/authPaths.ts')
const { LOCAL_USER } = require('../src/server/localLogin.ts')

// What src/server/betterAuth.ts hands Better Auth: the user a GitHub or Sparklingstadt ID login makes (an account ID,
// and an address made up from it, never the real one), and the paths under /api/auth that are answered over HTTP.

const unbase64url = value => Buffer.from(value).toString('base64url')
const idToken = claims => `${unbase64url(JSON.stringify({ alg: 'ES256' }))}.${unbase64url(JSON.stringify(claims))}.sig`

test('a GitHub login is the account github:<id>, with an address made from it, named by its name or else its login', () => {
  assert.deepEqual(githubUser({ id: 219588180, login: 'x', name: ' ', avatar_url: 'a' }),
    { id: 'github:219588180', name: 'x', image: 'a', email: 'github:219588180@users.invalid', emailVerified: true })
  const profile = { id: 42, login: ' octocat ', name: '  Mona Lisa  ', avatar_url: 'https://avatars.example/42' }
  assert.equal(githubUser(profile).name, 'Mona Lisa')
  for (const name of [null, undefined, '', '   ']) assert.equal(githubUser({ ...profile, name }).name, 'octocat')
  // A GitHub account that keeps its address private (no user:email scope is asked) still has one: the made-up one.
  assert.equal(githubUser({ ...profile, email: null }).email, 'github:42@users.invalid')
  assert.equal(githubUser({ ...profile, email: 'mona@example.com' }).email, 'github:42@users.invalid')
})

test('a Sparklingstadt ID login is the account sid:<sub>, named by its name, or by its address before @', () => {
  const claims = { sub: 'cm3abc', email: 'ann@example.test', email_verified: true, name: ' Ann ' }
  assert.deepEqual(sidUser(claims), { id: 'sid:cm3abc', name: 'Ann', image: '', email: 'sid:cm3abc@users.invalid', emailVerified: true })
  for (const name of [null, undefined, '', '  ']) assert.equal(sidUser({ ...claims, name }).name, 'ann')
  assert.equal(SID_PROVIDER_ID, 'sid')
})

test('a Sparklingstadt ID whose address is not confirmed, or whose sub is not of its form, is refused', () => {
  assert.throws(() => sidUser({ sub: 'abc', email_verified: false }))
  assert.throws(() => sidUser({ sub: 'ABC', email_verified: true }))
  const claims = { sub: 'cm3abc', email: 'ann@example.test', email_verified: true, name: 'Ann' }
  for (const changed of [{ email_verified: false }, { email_verified: undefined }, { email_verified: 'true' },
    { sub: 'A!' }, { sub: '' }, { sub: 'a'.repeat(65) }, { sub: 42 }]) {
    assert.throws(() => sidUser({ ...claims, ...changed }), JSON.stringify(changed))
  }
})

test('the user info of a Sparklingstadt ID login comes from its ID token, and a refused ID gives none', () => {
  const claims = { iss: 'https://id.example', sub: 'cm3abc', email: 'ann@example.test', email_verified: true, name: 'Ann' }
  assert.deepEqual(sidAccountInfo({ idToken: idToken(claims) }),
    { id: 'cm3abc', sub: 'cm3abc', name: 'Ann', email: 'sid:cm3abc@users.invalid', emailVerified: true })
  assert.equal(sidAccountInfo({ idToken: idToken({ ...claims, email_verified: false }) }), null)
  assert.equal(sidAccountInfo({ idToken: idToken({ ...claims, sub: 'ABC' }) }), null)
  // Without an ID token (the provider's own check of it comes first), nothing is read from elsewhere.
  assert.equal(sidAccountInfo({ accessToken: 'a' }), null)
  assert.equal(sidAccountInfo({ idToken: 'not a token' }), null)
})

test('/api/auth answers only the paths the logins use; every other path and method is not found', () => {
  const off = { localLogin: false }
  for (const [method, path] of [['GET', '/api/auth/get-session'], ['POST', '/api/auth/sign-out'],
    ['POST', '/api/auth/sign-in/social'], ['GET', '/api/auth/callback/github'], ['GET', '/api/auth/callback/sid']]) {
    assert.equal(authPathAllowed(method, path, off), true, `${method} ${path}`)
  }
  for (const [method, path] of [['GET', '/api/auth/session'], ['GET', '/api/auth/csrf'], ['GET', '/api/auth/providers'],
    ['POST', '/api/auth/signout'], ['GET', '/api/auth/signin/github'], ['POST', '/api/auth/token'], ['GET', '/api/auth/token'],
    ['POST', '/api/auth/get-session'], ['GET', '/api/auth/sign-out'], ['GET', '/api/auth/sign-in/social'],
    ['POST', '/api/auth/callback/github'], ['POST', '/api/auth/callback/sid'], ['GET', '/api/auth/callback/ffpf'],
    ['POST', '/api/auth/sign-up/email'], ['POST', '/api/auth/sign-in/email'], ['GET', '/api/auth/list-sessions'],
    ['POST', '/api/auth/revoke-sessions'], ['POST', '/api/auth/update-user'], ['POST', '/api/auth/delete-user'],
    ['POST', '/api/auth/link-social'], ['GET', '/api/auth/list-accounts'], ['POST', '/api/auth/get-access-token'],
    ['GET', '/api/auth/error'], ['GET', '/api/auth/ok'], ['GET', '/api/auth/get-session/'], ['GET', '/api/auth/'],
    ['GET', '/api/auth'], ['HEAD', '/api/auth/get-session'], ['POST', '/api/auth/sign-in/local'],
    ['GET', '/api/auth/callback/sid/x'], ['GET', '/api/auth/Get-Session'], ['GET', '/api/auth/get%2Dsession']]) {
    assert.equal(authPathAllowed(method, path, off), false, `${method} ${path}`)
  }
})

test('the development login is answered only when it is on', () => {
  assert.equal(authPathAllowed('POST', '/api/auth/sign-in/local', { localLogin: true }), true)
  assert.equal(authPathAllowed('GET', '/api/auth/sign-in/local', { localLogin: true }), false)
  assert.equal(authPathAllowed('POST', '/api/auth/sign-in/local', { localLogin: false }), false)
  assert.deepEqual(LOCAL_USER, { id: 'github:0', name: 'ローカル練習用', image: '' })
})

// The instance is built from the environment (which providers, whether the development login is on), so each of these
// runs it in a process of its own: script runs after `auth` is loaded, with origin, cookiesOf and report() at hand.
const databaseUrl = process.env.TYPLE_TEST_DATABASE_URL
const database = { skip: databaseUrl ? false : 'TYPLE_TEST_DATABASE_URL is not set' }
function runAuth(env, script, prelude = '') {
  const { spawnSync } = require('node:child_process')
  const path = require('node:path')
  const source = `
    require('./tests/register.cjs')
    const origin = 'http://127.0.0.1:3101'
    ${prelude}
    const { auth } = require('./src/server/betterAuth.ts')
    const cookiesOf = response => response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')
    const report = value => console.log(JSON.stringify(value))
    ;(async () => {
      try { ${script} } finally { await require('./src/server/database.ts').prisma().$disconnect() }
    })().catch(error => { console.error(error); process.exit(1) })
  `
  const childEnv = { ...process.env, DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: 'better-auth-test-secret-0123456789abcdef',
    AUTH_URL: 'http://127.0.0.1:3101', ...env }
  for (const name of ['AUTH_SID_ISSUER', 'AUTH_GITHUB_ID', 'LOCAL_DEVELOPMENT_LOGIN', 'VERCEL', 'NEXT_PHASE']) {
    if (!(name in env)) delete childEnv[name]
  }
  const run = spawnSync(process.execPath, ['-e', source], { cwd: path.join(__dirname, '..'), env: childEnv, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout.trim().split('\n').at(-1))
}

// The whole GitHub login against a GitHub stubbed at fetch: the account keeps its address private, and no scope asks
// for it, so GitHub gives none; Better Auth would refuse such a login (email_not_found) without the made-up address.
const githubStub = `
  const realFetch = globalThis.fetch
  const asked = []
  // The profile the stubbed GitHub answers next: the account keeps its address private.
  let profile = null
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    asked.push(url)
    if (url.startsWith('https://github.com/login/oauth/access_token')) return Response.json({ access_token: 'gho_test', refresh_token: 'ghr_test', expires_in: 28800, token_type: 'bearer', scope: '' })
    if (url === 'https://api.github.com/user') return Response.json({ email: null, ...profile })
    if (url === 'https://api.github.com/user/emails') return Response.json({ message: 'Not Found' }, { status: 404 })
    return realFetch(input, init)
  }
  /** A GitHub login of next, as a browser makes it: its callback's answer, and the session it made. */
  async function githubLogin(next) {
    profile = next
    const start = await auth.handler(new Request(origin + '/api/auth/sign-in/social', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ provider: 'github', callbackURL: '/home', errorCallbackURL: '/signin' }) }))
    const { url } = await start.json()
    const state = new URL(url).searchParams.get('state')
    const back = await auth.handler(new Request(origin + '/api/auth/callback/github?code=c&state=' + state,
      { headers: { Cookie: cookiesOf(start) } }))
    const session = await auth.handler(new Request(origin + '/api/auth/get-session', { headers: { Cookie: cookiesOf(back) } }))
    return { status: back.status, location: back.headers.get('location'), session: await session.json() }
  }
  const db = () => require('./src/server/database.ts').prisma()
  const userRow = async id => (await db().$queryRawUnsafe('SELECT name, image, email, email_verified FROM typle_auth_users WHERE id = $1', id))[0]
  const tokensOf = id => db().$queryRawUnsafe('SELECT access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at FROM typle_auth_accounts WHERE user_id = $1', id)
`
const noTokens = { access_token: null, refresh_token: null, id_token: null, access_token_expires_at: null, refresh_token_expires_at: null }

// The whole GitHub login against a GitHub stubbed at fetch: the account keeps its address private, and no scope asks
// for it, so GitHub gives none; Better Auth would refuse such a login (email_not_found) without the made-up address.
test('a GitHub login without an address makes the user github:<id>, keeping no token', database, () => {
  const githubId = 9e8 + Math.floor(Math.random() * 1e8)
  const result = runAuth({ AUTH_GITHUB_ID: 'test', AUTH_GITHUB_SECRET: 'test' }, `
    const id = 'github:${githubId}'
    try {
      const first = await githubLogin({ id: ${githubId}, login: 'octo', name: null, avatar_url: 'https://avatars.example/1' })
      const created = { user: await userRow(id), tokens: await tokensOf(id) }
      // The second login takes the account's update path.
      const second = await githubLogin({ id: ${githubId}, login: 'octo', name: 'Mona', avatar_url: 'https://avatars.example/2' })
      report({ first, created, second, updated: { user: await userRow(id), tokens: await tokensOf(id) }, asked })
    } finally { await (await auth.$context).internalAdapter.deleteUser(id) }
  `, githubStub)
  assert.equal(result.first.status, 302)
  assert.equal(result.first.location, '/home')
  assert.equal(result.first.session.user.id, `github:${githubId}`)
  assert.deepEqual(result.created.user,
    { name: 'octo', image: 'https://avatars.example/1', email: `github:${githubId}@users.invalid`, email_verified: true })
  assert.deepEqual(result.created.tokens, [noTokens])
  assert.equal(result.second.session.user.id, `github:${githubId}`)
  assert.deepEqual(result.updated.user,
    { name: 'Mona', image: 'https://avatars.example/2', email: `github:${githubId}@users.invalid`, email_verified: true })
  assert.deepEqual(result.updated.tokens, [noTokens])
  assert.ok(result.asked.includes('https://api.github.com/user'))
})

// An account imported from the login before (migration 0043) has no name; its first login gives it the profile's.
test('a GitHub login of an imported account fills in its name and picture, not its address', database, () => {
  const githubId = 9e8 + Math.floor(Math.random() * 1e8)
  const result = runAuth({ AUTH_GITHUB_ID: 'test', AUTH_GITHUB_SECRET: 'test' }, `
    const id = 'github:${githubId}'
    try {
      await db().$executeRawUnsafe("INSERT INTO typle_auth_users (id, name, email, email_verified) VALUES ($1, '', $2, true)", id, id + '@users.invalid')
      await db().$executeRawUnsafe("INSERT INTO typle_auth_accounts (id, account_id, provider_id, user_id) VALUES ($1, $2, 'github', $3)", 'test-' + ${githubId}, '${githubId}', id)
      const login = await githubLogin({ id: ${githubId}, login: 'owner', name: ' Owner ', avatar_url: 'https://avatars.example/3' })
      report({ login, user: await userRow(id), tokens: await tokensOf(id) })
    } finally { await (await auth.$context).internalAdapter.deleteUser(id) }
  `, githubStub)
  assert.equal(result.login.session.user.id, `github:${githubId}`)
  assert.deepEqual(result.user, { name: 'Owner', image: 'https://avatars.example/3', email: `github:${githubId}@users.invalid`, email_verified: true })
  assert.deepEqual(result.tokens, [noTokens])
})

const localLoginScript = `
  const signIn = await auth.handler(new Request(origin + '/api/auth/sign-in/local', { method: 'POST', headers: { Origin: origin } }))
  const session = signIn.ok
    ? await (await auth.handler(new Request(origin + '/api/auth/get-session', { headers: { Cookie: cookiesOf(signIn) } }))).json()
    : null
  report({ status: signIn.status, body: await signIn.text(), session })
`

test('the development login signs in as github:0 when it is on', database, () => {
  const result = runAuth({ LOCAL_DEVELOPMENT_LOGIN: '1' }, localLoginScript)
  assert.equal(result.status, 200)
  assert.equal(result.session.user.id, 'github:0')
  assert.equal(result.session.user.name, 'ローカル練習用')
  assert.equal(result.session.user.email, 'github:0@users.invalid')
  // A second login is the same user.
  assert.equal(runAuth({ LOCAL_DEVELOPMENT_LOGIN: '1' }, localLoginScript).session.user.id, 'github:0')
  runAuth({}, `await (await auth.$context).internalAdapter.deleteUser('github:0'); report(null)`)
})

test('the development login is not found when it is off, as on Vercel or at an https address', database, () => {
  for (const env of [{}, { LOCAL_DEVELOPMENT_LOGIN: '1', VERCEL: '1' }, { LOCAL_DEVELOPMENT_LOGIN: '1', AUTH_URL: 'https://typle.example' }]) {
    const result = runAuth(env, localLoginScript)
    assert.equal(result.status, 404, JSON.stringify(env))
    assert.deepEqual(JSON.parse(result.body), { error: 'notFound' })
  }
})

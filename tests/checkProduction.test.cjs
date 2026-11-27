const { test } = require('node:test')
const assert = require('node:assert/strict')
const { authResults, SITE } = require('../scripts/check-production.cjs')

// The Better Auth checks of scripts/check-production.cjs, with a fake fetch instead of the production site.
const ID = 'https://id.example.test'
const github = (origin = SITE) => `https://github.com/login/oauth/authorize?client_id=x&redirect_uri=${encodeURIComponent(`${origin}/api/auth/callback/github`)}`
const sid = (origin = SITE) => `${ID}/authorize?client_id=x&redirect_uri=${encodeURIComponent(`${origin}/api/auth/callback/sid`)}`

function fake({ session = { status: 200, body: 'null' }, githubUrl = github(), sidUrl = sid(), start, old = 404 } = {}) {
  const seen = []
  const send = async (url, init = {}) => {
    const path = new URL(url).pathname
    seen.push({ path, init })
    if (path === '/api/auth/get-session') return new Response(session.body, { status: session.status })
    if (path === '/api/auth/sign-in/social') {
      const provider = JSON.parse(init.body).provider
      if (start) return start(provider)
      const target = provider === 'github' ? githubUrl : sidUrl
      return new Response(JSON.stringify({ url: target, redirect: true }), { status: 200 })
    }
    return new Response('', { status: old })
  }
  send.seen = seen
  return send
}
const run = async options => (await authResults(SITE, fake(options), ID)).map(r => r.ok)
// get-session, GitHub, Sparklingstadt ID, then the removed /session, /providers and /csrf.
const ALL_OK = [true, true, true, true, true, true]

test('everything as Better Auth answers is OK', async () => {
  assert.deepEqual(await run(), ALL_OK)
})

test('an anonymous session must be null; one with a user, or a failure, is NG', async () => {
  assert.equal((await run({ session: { status: 200, body: '{"user":{"id":"github:1"}}' } }))[0], false)
  assert.equal((await run({ session: { status: 200, body: '{}' } }))[0], false)
  assert.equal((await run({ session: { status: 500, body: 'null' } }))[0], false)
})

test('the GitHub login starts at GitHub with the production callback', async () => {
  assert.equal((await run({ githubUrl: 'https://github.com/login/oauth/authorize?redirect_uri=http%3A%2F%2Fother' }))[1], false)
  assert.equal((await run({ githubUrl: `${SITE}/signin?error=Configuration` }))[1], false)
  assert.equal((await run({ start: () => new Response('{"message":"Provider not found"}', { status: 404 }) }))[1], false)
})

test('the Sparklingstadt ID login starts at the ID server with the production callback', async () => {
  assert.equal((await run({ sidUrl: `https://other.example/authorize?redirect_uri=${encodeURIComponent(`${SITE}/api/auth/callback/sid`)}` }))[2], false)
  assert.equal((await run({ sidUrl: `${ID}/authorize?redirect_uri=http%3A%2F%2Fother` }))[2], false)
  // The provider is dropped when the ID server's discovery failed at startup: the start is then an error.
  assert.equal((await run({ start: provider => provider === 'sid'
    ? new Response('{"message":"Provider not found"}', { status: 404 }) : new Response(JSON.stringify({ url: github() }), { status: 200 }) }))[2], false)
})

test('a start is sent with the site origin as its Origin header', async () => {
  const send = fake()
  await authResults(SITE, send, ID)
  const starts = send.seen.filter(request => request.path === '/api/auth/sign-in/social')
  assert.equal(starts.length, 2)
  for (const { init } of starts) assert.equal(init.headers.Origin, SITE)
})

test('Auth.js\'s endpoints must be gone', async () => {
  assert.deepEqual(await run({ old: 200 }), [true, true, true, false, false, false])
})

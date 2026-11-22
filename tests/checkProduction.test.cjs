const { test } = require('node:test')
const assert = require('node:assert/strict')
const { authResults, SITE } = require('../scripts/check-production.cjs')

// The Auth.js checks of scripts/check-production.cjs, with a fake fetch instead of the production site.
const CALLBACK = encodeURIComponent(`${SITE}/api/auth/callback/github`)
const GITHUB = `https://github.com/login/oauth/authorize?client_id=x&redirect_uri=${CALLBACK}`

function fake({ session = 'null', providers = { sid: {}, github: {} }, location = GITHUB, status = 302 } = {}) {
  return async (url, init = {}) => {
    const path = new URL(url).pathname
    const headers = new Headers()
    if (path === '/api/auth/csrf') headers.append('set-cookie', 'authjs.csrf-token=abc%7Chash; Path=/; HttpOnly')
    if (path === '/api/auth/signin/github' && location) headers.set('location', location)
    const body = path === '/api/auth/session' ? session : path === '/api/auth/providers' ? JSON.stringify(providers)
      : path === '/api/auth/csrf' ? JSON.stringify({ csrfToken: 'abc' }) : ''
    return new Response(body, { status: path === '/api/auth/signin/github' ? status : 200, headers })
  }
}
const run = async options => (await authResults(SITE, fake(options))).map(r => r.ok)

test('an anonymous session is null or has no user; one with a user is NG', async () => {
  assert.deepEqual(await run({ session: 'null' }), [true, true, true, true])
  assert.deepEqual(await run({ session: '{}' }), [true, true, true, true])
  assert.equal((await run({ session: '{"user":{"id":"github:1"}}' }))[0], false)
})

test('the providers must be Sparklingstadt ID and GitHub only', async () => {
  assert.equal((await run({ providers: { sid: {}, github: {} } }))[1], true)
  assert.equal((await run({ providers: { github: {} } }))[1], false)
  assert.equal((await run({ providers: { sid: {} } }))[1], false)
  // The ID and password login is gone: a production that still offers it is NG.
  assert.equal((await run({ providers: { sid: {}, github: {}, password: {} } }))[1], false)
})

test('the GitHub sign-in is a 302 to GitHub with the production redirect_uri', async () => {
  assert.equal((await run())[3], true)
  assert.equal((await run({ location: 'https://github.com/login/oauth/authorize?redirect_uri=http%3A%2F%2Fother' }))[3], false)
  assert.equal((await run({ location: `${SITE}/signin?error=Configuration` }))[3], false)
  assert.equal((await run({ status: 200 }))[3], false)
})

require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SID_RELOGIN_COOKIE, sidSignInUrl, withSidRelogin } = require('../src/server/sidLogin.ts')

// After signing out, the next Sparklingstadt ID login asks for the password (prompt=login), as the ID server would
// otherwise let a browser still signed in there through without one: the cookie typle-sid-relogin says so from the
// sign-out until a Sparklingstadt ID login succeeds.

const origin = 'http://127.0.0.1:3101'
const withCookie = { cookie: `other=1; ${SID_RELOGIN_COOKIE}=1` }
const request = (path, method = 'POST', headers = {}) => new Request(origin + path, { method, headers })
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const redirect = location => new Response(null, { status: 302, headers: { Location: location } })
const setCookie = response => response.headers.get('set-cookie')

test('a Sparklingstadt ID sign-in after a sign-out asks for the password', () => {
  assert.equal(sidSignInUrl(request('/api/auth/signin/sid?x=1', 'POST', withCookie)), `${origin}/api/auth/signin/sid?x=1&prompt=login`)
  assert.equal(sidSignInUrl(request('/api/auth/signin/sid', 'GET', withCookie)), `${origin}/api/auth/signin/sid?prompt=login`)
  // No sign-out before, or another provider: as it is.
  assert.equal(sidSignInUrl(request('/api/auth/signin/sid')), null)
  assert.equal(sidSignInUrl(request('/api/auth/signin/sid', 'POST', { cookie: `x${SID_RELOGIN_COOKIE}=1` })), null)
  assert.equal(sidSignInUrl(request('/api/auth/signin/github', 'POST', withCookie)), null)
  assert.equal(sidSignInUrl(request('/api/auth/callback/sid', 'GET', withCookie)), null)
})

test('a sign-out that went through leaves the cookie for 30 days', async () => {
  for (const [path, response] of [
    ['/api/auth/signout', json({ url: `${origin}/home` })],
    ['/api/auth/signout', redirect(`${origin}/home`)],
    ['/api/account/signout-everywhere', new Response(null, { status: 204 })],
  ]) {
    const cookie = setCookie(await withSidRelogin(request(path), response, false))
    assert.match(cookie ?? '', new RegExp(`^${SID_RELOGIN_COOKIE}=1; `), path)
    for (const part of ['Path=/', 'Max-Age=2592000', 'HttpOnly', 'SameSite=Lax']) assert.ok(cookie.includes(part), `${path} ${part}`)
    assert.ok(!cookie.includes('Secure'), path)
  }
  assert.ok(setCookie(await withSidRelogin(request('/api/account/signout-everywhere'), new Response(null, { status: 204 }), true)).includes('Secure'))
})

test('a sign-out that failed leaves no cookie, and the answer is kept as it was', async () => {
  for (const [path, response] of [
    ['/api/auth/signout', json({ url: `${origin}/api/auth/error?error=Configuration` })],
    ['/api/auth/signout', json({ message: 'x' }, 500)],
    ['/api/auth/signout', redirect(`${origin}/signin?error=MissingCSRF`)],
    ['/api/account/signout-everywhere', json({ message: 'forbidden' }, 403)],
  ]) {
    const answered = await withSidRelogin(request(path), response, false)
    assert.equal(setCookie(answered), null, path)
    assert.equal(answered.status, response.status, path)
  }
  const answered = await withSidRelogin(request('/api/auth/signout'), json({ url: `${origin}/home` }), false)
  assert.deepEqual(await answered.json(), { url: `${origin}/home` })
  // A GET of the sign-out page signs nobody out.
  assert.equal(setCookie(await withSidRelogin(request('/api/auth/signout', 'GET'), json({ url: '/' }), false)), null)
})

test('a Sparklingstadt ID login that succeeded removes the cookie; one that failed keeps it', async () => {
  const done = await withSidRelogin(request('/api/auth/callback/sid?code=c', 'GET', withCookie), redirect(`${origin}/home`), false)
  assert.match(setCookie(done), new RegExp(`^${SID_RELOGIN_COOKIE}=; .*Max-Age=0`))
  const failed = await withSidRelogin(request('/api/auth/callback/sid?code=c', 'GET', withCookie), redirect(`${origin}/signin?error=OAuthCallbackError`), false)
  assert.equal(setCookie(failed), null)
  // Without the cookie there is nothing to remove; other logins leave it.
  assert.equal(setCookie(await withSidRelogin(request('/api/auth/callback/sid', 'GET'), redirect(`${origin}/home`), false)), null)
  assert.equal(setCookie(await withSidRelogin(request('/api/auth/callback/github', 'GET', withCookie), redirect(`${origin}/home`), false)), null)
})

require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SID_RELOGIN_COOKIE, hasReloginCookie, withSidRelogin } = require('../src/server/sidLogin.ts')

// After signing out, the next Sparklingstadt ID login asks for the password (prompt=login), as the ID server would
// otherwise let a browser still signed in there through without one: the cookie typle-sid-relogin says so from the
// sign-out until a Sparklingstadt ID login succeeds. The Better Auth side (POST /api/auth/sign-out, the login's start
// and callback) is the plugin sidRelogin, run by tests/e2e/sid-login.spec.ts; signing out of every device is a Route
// Handler of its own.

const origin = 'http://127.0.0.1:3101'
const request = (path, method = 'POST') => new Request(origin + path, { method })
const setCookie = response => response.headers.get('set-cookie')

test('the relogin cookie is read from the Cookie header by its exact name', () => {
  assert.equal(SID_RELOGIN_COOKIE, 'typle-sid-relogin')
  assert.equal(hasReloginCookie(`other=1; ${SID_RELOGIN_COOKIE}=1`), true)
  assert.equal(hasReloginCookie(`${SID_RELOGIN_COOKIE}=1`), true)
  assert.equal(hasReloginCookie(`x${SID_RELOGIN_COOKIE}=1`), false)
  assert.equal(hasReloginCookie(null), false)
})

test('signing out of every device leaves the relogin cookie when it went through', async () => {
  const done = await withSidRelogin(request('/api/account/signout-everywhere'), new Response(null, { status: 204 }), false)
  assert.match(setCookie(done) ?? '', new RegExp(`^${SID_RELOGIN_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000$`))
  assert.ok(setCookie(await withSidRelogin(request('/api/account/signout-everywhere'), new Response(null, { status: 204 }), true)).includes('Secure'))
  for (const status of [401, 403, 503]) {
    assert.equal(setCookie(await withSidRelogin(request('/api/account/signout-everywhere'), new Response(null, { status }), false)), null)
  }
  assert.equal(setCookie(await withSidRelogin(request('/api/account/signout-everywhere', 'GET'), new Response(null, { status: 200 }), false)), null)
  assert.equal(setCookie(await withSidRelogin(request('/api/workspace'), new Response(null, { status: 200 }), false)), null)
})

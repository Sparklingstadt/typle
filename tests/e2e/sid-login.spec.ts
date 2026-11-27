import { randomInt } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { origin, withDatabase } from './account'

// Signing in with Sparklingstadt ID through Better Auth's /api/auth and the fake ID server (tests/e2e/fakeSid.cjs),
// driven at the endpoints rather than the screens: an ID whose sid account belongs to a user signs in as that user (the
// owner's GitHub account, linked by npm run sid:link), a new ID is its own user sid:<sub>, an unconfirmed address is
// refused, and after a sign-out the next login asks the ID server for the password.

const sid = 'http://127.0.0.1:3197'
// The fake ID server signs in as one identity at a time, set before each login.
test.describe.configure({ mode: 'serial' })

let sub = ''
let linkedTo = ''
test.beforeEach(() => {
  sub = `e2e${randomInt(1e9, 2e9)}`
  linkedTo = `github:${randomInt(1e9, 2e9)}`
})
test.afterEach(() => withDatabase(async pool => {
  // The sessions and accounts go with their users.
  await pool.query('DELETE FROM typle_auth_users WHERE id = ANY($1)', [[`sid:${sub}`, linkedTo]])
  await pool.query('DELETE FROM typle_workspaces WHERE owner_id = ANY($1)', [[`sid:${sub}`, linkedTo]])
}))

/** Makes the fake ID server sign in as sub next. */
async function nextIdentity(identity: { email_verified?: boolean } = {}) {
  await fetch(`${sid}/next`, {
    method: 'POST',
    body: JSON.stringify({ sub, email: `${sub}@example.test`, email_verified: true, name: 'Ann', ...identity }),
  })
}

/** The query of the newest authorization request the fake ID server received. */
async function lastAuthorization(): Promise<Record<string, string>> {
  return (await (await fetch(`${sid}/requests`)).json() as Record<string, string>[]).at(-1) ?? {}
}

/** Starts a Sparklingstadt ID login as the sign-in page does, and follows it to where it ends; answers that path. */
async function signInWithSid(page: Page): Promise<string> {
  const start = await page.request.post('/api/auth/sign-in/social', {
    headers: { Origin: origin },
    data: { provider: 'sid', callbackURL: '/home', errorCallbackURL: '/signin' },
  })
  expect(start.status()).toBe(200)
  const { url } = await start.json() as { url: string }
  expect(url.startsWith(`${sid}/authorize?`)).toBe(true)
  // The ID server answers at once and sends the browser back to the callback, which sends it on: no page is needed.
  await page.goto(url, { waitUntil: 'commit' })
  const landed = new URL(page.url())
  return landed.pathname + landed.search
}

const sessionUser = async (page: Page) =>
  (await (await page.request.get('/api/auth/get-session')).json() as { user?: { id: string, name: string } } | null)?.user ?? null

const reloginCookie = async (page: Page) =>
  (await page.context().cookies(origin)).find(cookie => cookie.name === 'typle-sid-relogin')?.value

test('sid login of a new sub makes sid:<sub>', async ({ page }) => {
  await nextIdentity()
  expect(await signInWithSid(page)).toBe('/home')
  const authorization = await lastAuthorization()
  expect(authorization.redirect_uri).toBe(`${origin}/api/auth/callback/sid`)
  expect(authorization.scope).toBe('openid email profile')
  expect(authorization.code_challenge_method).toBe('S256')
  expect(authorization.nonce).toBeTruthy()
  expect(await sessionUser(page)).toMatchObject({ id: `sid:${sub}`, name: 'Ann' })
  // The real address is not kept: the user has the one made up from its ID.
  const row = await withDatabase(async pool => (await pool.query(
    'SELECT email, email_verified FROM typle_auth_users WHERE id = $1', [`sid:${sub}`])).rows[0])
  expect(row).toEqual({ email: `sid:${sub}@users.invalid`, email_verified: true })
})

test('sid login of a linked sub opens the github account', async ({ page }) => {
  await withDatabase(async pool => {
    await pool.query(`INSERT INTO typle_auth_users (id, name, email, email_verified) VALUES ($1, 'Owner', $2, true)`,
      [linkedTo, `${linkedTo}@users.invalid`])
    await pool.query(`INSERT INTO typle_auth_accounts (id, account_id, provider_id, user_id) VALUES
      ($1, $2, 'github', $4), ($3, $5, 'sid', $4)`,
    [`e2e-gh-${sub}`, linkedTo.slice('github:'.length), `e2e-sid-${sub}`, linkedTo, sub])
    await pool.query(`INSERT INTO typle_workspaces (owner_id, lists) VALUES ($1, '[]')`, [linkedTo])
  })
  await nextIdentity()
  expect(await signInWithSid(page)).toBe('/home')
  expect(await sessionUser(page)).toMatchObject({ id: linkedTo, name: 'Owner' })
  // No user sid:<sub> is made beside it.
  const own = await withDatabase(async pool => (await pool.query('SELECT 1 FROM typle_auth_users WHERE id = $1', [`sid:${sub}`])).rowCount)
  expect(own).toBe(0)
})

test('sid login with an unverified address is refused', async ({ page }) => {
  await nextIdentity({ email_verified: false })
  expect(await signInWithSid(page)).toMatch(/^\/signin\?error=/)
  expect(await sessionUser(page)).toBeNull()
  const made = await withDatabase(async pool => (await pool.query('SELECT 1 FROM typle_auth_users WHERE id = $1', [`sid:${sub}`])).rowCount)
  expect(made).toBe(0)
})

test('sid login after sign-out asks for the password again', async ({ page }) => {
  await nextIdentity()
  expect(await signInWithSid(page)).toBe('/home')
  expect((await lastAuthorization()).prompt).toBeUndefined()

  const signOut = await page.request.post('/api/auth/sign-out', { headers: { Origin: origin } })
  expect(signOut.status()).toBe(200)
  expect(await sessionUser(page)).toBeNull()
  expect(await reloginCookie(page)).toBe('1')

  expect(await signInWithSid(page)).toBe('/home')
  expect((await lastAuthorization()).prompt).toBe('login')
  expect(await sessionUser(page)).toMatchObject({ id: `sid:${sub}` })
  // The login that went through removed the cookie, so the one after it asks for nothing.
  expect(await reloginCookie(page)).toBeUndefined()
  expect(await signInWithSid(page)).toBe('/home')
  expect((await lastAuthorization()).prompt).toBeUndefined()
})

test('a refused sid login keeps asking for the password', async ({ page }) => {
  await page.context().addCookies([{ name: 'typle-sid-relogin', value: '1', url: origin, httpOnly: true, sameSite: 'Lax' }])
  await nextIdentity({ email_verified: false })
  expect(await signInWithSid(page)).toMatch(/^\/signin\?error=/)
  expect((await lastAuthorization()).prompt).toBe('login')
  expect(await reloginCookie(page)).toBe('1')
})

test('a login may only come back to this site', async ({ page }) => {
  for (const callbackURL of ['https://evil.example/home', '//evil.example/home', `${sid}/home`]) {
    const start = await page.request.post('/api/auth/sign-in/social', {
      headers: { Origin: origin }, data: { provider: 'sid', callbackURL },
    })
    expect(start.status(), callbackURL).toBe(403)
  }
  const own = await page.request.post('/api/auth/sign-in/social', {
    headers: { Origin: origin }, data: { provider: 'sid', callbackURL: `${origin}/home` },
  })
  expect(own.status()).toBe(200)
  const start = await page.request.post('/api/auth/sign-in/social', {
    headers: { Origin: origin }, data: { provider: 'sid', callbackURL: '/home', errorCallbackURL: 'https://evil.example/' },
  })
  expect(start.status()).toBe(403)
})

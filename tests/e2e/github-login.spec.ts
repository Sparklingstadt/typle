import { test, expect } from '@playwright/test'
import { origin } from './account'

// A GitHub login starts at Better Auth's /api/auth/sign-in/social and goes to GitHub with no scope, to come back to
// AUTH_URL's /api/auth/callback/github: the callback the GitHub OAuth app already has. What the callback makes of a
// profile without an address (no scope asks for it) is run against a stubbed GitHub in tests/betterAuthProviders.test.cjs,
// as the code and the profile are fetched by the server, out of the browser's reach.

test('github login works without an email', async ({ page }) => {
  const response = await page.request.post('/api/auth/sign-in/social', {
    headers: { Origin: origin },
    data: { provider: 'github', callbackURL: '/play', errorCallbackURL: '/signin' },
  })
  expect(response.status()).toBe(200)
  const url = new URL((await response.json() as { url: string }).url)
  expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
  expect(url.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/callback/github`)
  expect(url.searchParams.get('scope') ?? '').toBe('')
  expect(url.searchParams.get('client_id')).toBe('e2e')
  expect(url.searchParams.get('state')).toBeTruthy()
})

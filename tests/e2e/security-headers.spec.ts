import { test, expect } from '@playwright/test'

// next.config.mjs sends these with every page, file and Route Handler (every /api path since v2.46.10). Pages get no
// Content-Security-Policy until the script policy of src/proxy.ts is enforced.
for (const path of ['/home', '/robots.txt', '/api/health', '/api/auth/session', '/api/workspace/records', '/api/workspace']) {
  test(`${path} cannot be framed by another site`, async ({ request }) => {
    const headers = (await request.get(path)).headers()
    expect(headers['content-security-policy']).toBe(path === '/home' ? undefined : "frame-ancestors 'none'; base-uri 'self'; object-src 'none'")
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
    expect(headers['x-powered-by']).toBeUndefined()
  })
}

// src/proxy.ts reports scripts without the page's nonce. Every script Next.js and the layout put in the page carries it,
// so a page that only runs its own scripts reports nothing.
test('a page reports scripts without its nonce, and its own scripts carry it', async ({ page }) => {
  const violations: string[] = []
  page.on('console', message => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text())
  })
  const response = await page.goto('/home')
  const policy = response?.headers()['content-security-policy-report-only'] ?? ''
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1]
  expect(nonce).toBeTruthy()
  expect(policy).toContain("'strict-dynamic'")
  await expect(page.locator('#theme-bootstrap')).toHaveJSProperty('nonce', nonce!)
  await page.waitForLoadState('networkidle')
  expect(violations).toEqual([])
})

test('a second page view gets another nonce', async ({ request }) => {
  const policy = async () => (await request.get('/home')).headers()['content-security-policy-report-only']
  expect(await policy()).not.toBe(await policy())
})

test('Route Handlers get no script policy', async ({ request }) => {
  expect((await request.get('/api/health')).headers()['content-security-policy-report-only']).toBeUndefined()
})

// In v2.51.0 a page's request on Vercel carried the enforced policy too, and Next.js read that one and found no nonce.
test('a policy already on the request does not take the nonce away', async ({ request }) => {
  const response = await request.get('/home', { headers: { 'content-security-policy': "frame-ancestors 'none'" } })
  const nonce = /'nonce-([^']+)'/.exec(response.headers()['content-security-policy-report-only'] ?? '')?.[1]
  expect(nonce).toBeTruthy()
  const scripts = (await response.text()).match(/<script\b[^>]*>/g) ?? []
  expect(scripts.length).toBeGreaterThan(1)
  for (const script of scripts) expect(script).toContain(`nonce="${nonce}"`)
})

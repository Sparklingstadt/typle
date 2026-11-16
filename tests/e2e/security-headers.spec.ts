import { test, expect } from '@playwright/test'

// next.config.mjs sends these with every page and Route Handler (every /api path since v2.46.10).
for (const path of ['/home', '/api/health', '/api/gallery', '/api/shared?id=00000000-0000-0000-0000-000000000000', '/api/gallery/added', '/api/workspace']) {
  test(`${path} cannot be framed by another site`, async ({ request }) => {
    const headers = (await request.get(path)).headers()
    expect(headers['content-security-policy']).toBe("frame-ancestors 'none'; base-uri 'self'; object-src 'none'")
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })
}

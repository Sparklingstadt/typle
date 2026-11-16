import { test, expect } from '@playwright/test'

// The gallery's query as it reaches the Route Handler through Next.js, which writes the query again with
// URLSearchParams before the handler sees it (src/server/gallery.ts, parseGalleryQuery).
test('a NUL or a bad page is refused', async ({ request }) => {
  for (const query of ['q=a%00b', 'category=a%00b', 'page=0', 'page=abc', 'sort=old']) {
    const response = await request.get(`/api/gallery?${query}`)
    expect(response.status(), query).toBe(400)
    expect(await response.text(), query).toBe('{"error":"invalidQuery"}\n')
    expect(response.headers()['x-robots-tag'], query).toBe('noindex')
  }
})

// Go refused an escape that is not UTF-8; Next.js turns it into U+FFFD first, so it is searched for.
test('an escape that is not UTF-8 is searched for', async ({ request }) => {
  const response = await request.get('/api/gallery?q=%FF')
  expect(response.status()).toBe(200)
  expect(JSON.parse(await response.text())).toEqual({ packs: [], more: false })
})

import { test, expect } from '@playwright/test'

// /api/health is a Route Handler of the app (src/app/api/health/route.ts), not forwarded to the Go backend.
test('/api/health says the database answers', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.status()).toBe(200)
  expect(await response.text()).toBe('{"status":"ok"}\n')
  expect(response.headers()['cache-control']).toBe('private, no-store')
})

test('HEAD /api/health has no body', async ({ request }) => {
  const response = await request.head('/api/health')
  expect(response.status()).toBe(200)
  expect(await response.text()).toBe('')
})

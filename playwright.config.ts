import { defineConfig } from '@playwright/test'
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

/** Playwright takes a number of workers or a share of the cores ('50%'); the variable is a string either way. */
function e2eWorkers(value: string | undefined): number | string {
  if (!value) return 6
  if (/^\d+%$/.test(value)) return value
  const count = Number(value)
  if (!Number.isInteger(count) || count < 1) throw new Error(`TYPLE_E2E_WORKERS must be a whole number or a share such as 50%, got ${value}`)
  return count
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Every test shares one next start, so more browsers stop paying off long before the cores run
  // out: on a 14-core Mac (2026-11-10) the suite took about 63 s with 4 workers, 56 s with 5 or 6, 61 s with 7
  // (Playwright's default, half of the cores), 72 s with 10 and 88 s with 14. TYPLE_E2E_WORKERS sets another number or
  // share, such as 4 or 50%.
  workers: e2eWorkers(process.env.TYPLE_E2E_WORKERS),
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:3101', trace: 'retain-on-failure' },
  reporter: [['list']],
  // Next.js serves the pages and the API (Route Handlers): every /api path is a Route Handler since v2.46.10.
  webServer: [
    {
      env: {
        BETTER_AUTH_SECRET: 'typle-e2e-only-better-auth-secret-32-bytes',
        AUTH_URL: 'http://127.0.0.1:3101',
        // The cookie cache of a session lasts 3 s instead of 5 minutes, so that tests can wait it out (tests/e2e/sessions.spec.ts).
        COOKIE_CACHE_SECONDS: '3',
        // The session lists GitHub as a login, as the Go backend did with these.
        AUTH_GITHUB_ID: 'e2e',
        AUTH_GITHUB_SECRET: 'e2e',
        // Sparklingstadt ID is the fake one below (tests/e2e/fakeSid.cjs).
        AUTH_SID_ISSUER: 'http://127.0.0.1:3197',
        AUTH_SID_ID: 'e2e',
        AUTH_SID_SECRET: 'e2e',
        // The shared demo account and the secret of its daily reset (tests/e2e/demo-login.spec.ts).
        DEMO_LOGIN: '1',
        CRON_SECRET: 'e2e-cron',
      },
      command: 'node node_modules/next/dist/bin/next start -p 3101 -H 127.0.0.1',
      url: 'http://127.0.0.1:3101',
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: 'node tests/e2e/fakeSid.cjs',
      url: 'http://127.0.0.1:3197/.well-known/openid-configuration',
      reuseExistingServer: false,
      timeout: 10000,
    },
  ],
})

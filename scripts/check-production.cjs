// Checks production after `vercel deploy --prod` (docs/release-workflow.md): what the deploy job of the CI workflow
// did until v2.38.0. Run once the production domain serves the new deployment. Exits 1 when any check fails.
//
// The site is served at typle.sparklingstadt.com (SITE_URL and AUTH_URL). The Vercel domain typle-r-six.vercel.app
// stays for the iPad and Mac apps, which call /api/* there: vercel.json sends its pages to the custom domain. The apps
// can no longer sign in (the app tokens were removed in v2.55.0), so only its pages and /api/* are checked.
const SITE = 'https://typle.sparklingstadt.com'
const LEGACY = 'https://typle-r-six.vercel.app'

const failures = []
function check(ok, message, detail) {
  console.log(`${ok ? 'ok' : 'NG'}  ${message}${ok ? '' : ` (${detail})`}`)
  if (!ok) failures.push(message)
}

/** fetch without following redirects, retried on network errors as curl --retry 3 did. */
async function request(url, init = {}) {
  let error
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60000), ...init })
    } catch (e) {
      error = e
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
  throw error
}

async function main() {
  const home = await request(`${SITE}/home`, { redirect: 'follow' })
  check(home.ok, `GET ${SITE}/home succeeds`, `HTTP ${home.status}`)

  const legacyHome = await request(`${LEGACY}/home?from=check`)
  const legacyTarget = legacyHome.headers.get('location')
  check(legacyHome.status === 308 && legacyTarget === `${SITE}/home?from=check`,
    `the Vercel domain sends pages to ${SITE} with HTTP 308 and the query intact`, `HTTP ${legacyHome.status} ${legacyTarget}`)

  for (const origin of [SITE, LEGACY]) {
    const health = await request(`${origin}/api/health`)
    check(health.ok, `GET ${origin}/api/health succeeds (the Route Handler reaches the production DB)`, `HTTP ${health.status}`)
    const workspace = await request(`${origin}/api/workspace`)
    check(workspace.status === 401, `anonymous GET ${origin}/api/workspace answers 401`, `HTTP ${workspace.status}`)
  }

  // Auth.js (src/auth.ts): no session for an anonymous visitor, GitHub and the ID and password among the providers.
  const session = await request(`${SITE}/api/auth/session`)
  const sessionBody = await session.text()
  let parsed
  try { parsed = JSON.parse(sessionBody) } catch { parsed = null }
  check(session.status === 200 && parsed !== null && typeof parsed === 'object' && !parsed.user,
    `anonymous ${SITE}/api/auth/session answers 200 without a user`, `HTTP ${session.status} ${sessionBody}`)

  const providersResponse = await request(`${SITE}/api/auth/providers`)
  const providersBody = await providersResponse.text()
  let providers
  try { providers = JSON.parse(providersBody) } catch { providers = null }
  check(providersResponse.status === 200 && providers !== null && typeof providers === 'object' &&
    Object.hasOwn(providers, 'github') && Object.hasOwn(providers, 'password'),
  `${SITE}/api/auth/providers lists github and password`, `HTTP ${providersResponse.status} ${providersBody}`)

  // Signing in with GitHub is a POST with Auth.js's CSRF token (and the cookie that came with it); the answer is a 302
  // to GitHub's authorize page, which carries the production callback as its redirect_uri.
  const csrf = await request(`${SITE}/api/auth/csrf`)
  let csrfToken
  try { csrfToken = (await csrf.json()).csrfToken } catch { csrfToken = undefined }
  const csrfCookies = csrf.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')
  check(csrf.status === 200 && typeof csrfToken === 'string' && csrfToken !== '' && csrfCookies !== '',
    `${SITE}/api/auth/csrf gives a token and its cookie`, `HTTP ${csrf.status}`)
  const signin = await request(`${SITE}/api/auth/signin/github`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: SITE, Cookie: csrfCookies },
    body: new URLSearchParams({ csrfToken: csrfToken ?? '', callbackUrl: `${SITE}/home` }),
  })
  const signinTarget = signin.headers.get('location') ?? ''
  check(signin.status === 302 && signinTarget.startsWith('https://github.com/login/oauth/authorize?') &&
    signinTarget.includes('redirect_uri=https%3A%2F%2Ftyple.sparklingstadt.com%2Fapi%2Fauth%2Fcallback%2Fgithub'),
  `POST ${SITE}/api/auth/signin/github with the CSRF token redirects (302) to GitHub with the production callback`,
  `HTTP ${signin.status} ${signinTarget}`)

  if (failures.length) {
    console.error(`\n${failures.length} production check(s) failed`)
    process.exit(1)
  }
  console.log('\nProduction checks passed')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

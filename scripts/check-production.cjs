// Checks production after `vercel deploy --prod` (docs/release-workflow.md): the last step of the CI's deploy job
// (.github/workflows/ci.yml, since v2.60.6), and `npm run check:production` when the deploy is done by hand. Run once
// the production domain serves the new deployment. Exits 1 when any check fails. It needs no dependencies.
//
// The site is served at typle.sparklingstadt.com (SITE_URL and AUTH_URL). The Vercel domain typle-r-six.vercel.app
// stays for the iPad and Mac apps, which call /api/* there: vercel.json sends its pages to the custom domain. The apps
// can no longer sign in (the app tokens were removed in v2.55.0), so only its pages and /api/* are checked.
const SITE = 'https://typle.sparklingstadt.com'
const LEGACY = 'https://typle-r-six.vercel.app'
// The Sparklingstadt ID server, where a Sparklingstadt ID login starts (AUTH_SID_ISSUER in the app's environment).
const ID_ISSUER = process.env.AUTH_SID_ISSUER || 'https://id.sparklingstadt.com'

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

/**
 * The Better Auth checks against site, as {ok, message, detail} results; send is a fetch that does not follow redirects
 * (replaceable, so that tests/checkProduction.test.cjs runs without a network). idIssuer is the Sparklingstadt ID
 * server's origin: its host is where starting a Sparklingstadt ID login must lead. A POST carries the site's origin as
 * its Origin header, which Better Auth checks.
 */
async function authResults(site, send, idIssuer = ID_ISSUER) {
  const results = []
  const add = (ok, message, detail) => results.push({ ok, message, detail })
  const origin = site
  // Better Auth (src/server/betterAuth.ts): no session for an anonymous visitor (the body is null).
  const session = await send(`${origin}/api/auth/get-session`)
  const sessionBody = await session.text()
  add(session.status === 200 && sessionBody.trim() === 'null',
    `anonymous GET ${origin}/api/auth/get-session answers 200 with null`, `HTTP ${session.status} ${sessionBody}`)

  // Starting a login is a POST that answers the provider's authorize URL (status 200, {url}), which carries the
  // production callback as its redirect_uri. A Sparklingstadt ID login that fails here is one whose discovery failed at
  // startup (the provider is dropped), which the instance keeps until it restarts.
  const start = async (provider, expectedHost, expectedPath, label) => {
    const response = await send(`${origin}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ provider, callbackURL: '/' }),
    })
    const body = await response.text()
    let target = null
    try { target = new URL(JSON.parse(body).url) } catch { target = null }
    add(response.status === 200 && target !== null && target.host === expectedHost && (expectedPath === null || target.pathname === expectedPath) &&
      target.searchParams.get('redirect_uri') === `${origin}/api/auth/callback/${provider}`,
    `POST ${origin}/api/auth/sign-in/social for ${label} answers ${expectedHost}${expectedPath ?? ''} with the production callback`,
    `HTTP ${response.status} ${body}`)
  }
  await start('github', 'github.com', '/login/oauth/authorize', 'GitHub')
  await start('sid', new URL(idIssuer).host, null, 'Sparklingstadt ID')

  // The development login is off in production.
  const local = await send(`${origin}/api/auth/sign-in/local`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' })
  add(local.status === 404, `POST ${origin}/api/auth/sign-in/local answers 404 (the development login is off)`, `HTTP ${local.status}`)

  // The Auth.js endpoints are gone.
  for (const path of ['session', 'providers', 'csrf']) {
    const response = await send(`${origin}/api/auth/${path}`)
    add(response.status === 404, `${origin}/api/auth/${path} answers 404 (Auth.js is gone)`, `HTTP ${response.status}`)
  }
  return results
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

  for (const { ok, message, detail } of await authResults(SITE, request)) check(ok, message, detail)

  if (failures.length) {
    console.error(`\n${failures.length} production check(s) failed`)
    process.exit(1)
  }
  console.log('\nProduction checks passed')
}

if (require.main === module) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = { authResults, SITE }

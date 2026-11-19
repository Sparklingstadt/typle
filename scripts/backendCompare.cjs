// The comparison of the backends (docs/superpowers/specs/2026-11-19-backend-compare-design.md): a deployment built with
// TYPLE_BACKEND_COMPARE=1 sends a request for one of these paths to the Go function or to the Kotlin service on Cloud
// Run when its x-typle-backend header names that backend, and to the Next.js Route Handlers otherwise. Without the
// variable there are no such rewrites, so the header changes nothing. next.config.mjs and scripts/bench-backends.cjs
// share this list.

/** The header that picks the backend of a request, and that each backend answers with its own name. */
const BACKEND_HEADER = 'x-typle-backend'

/** The paths the comparison covers, as next.config.mjs sources. */
const COMPARED_PATHS = ['/api/health', '/api/workspace', '/api/workspace/records']

/**
 * Where the Vercel Go function (api/go.go) is served. Vercel maps the file to this one path and no paths below it, so
 * the compared path goes in the path query, which the function routes on (as it does on the original path).
 */
const GO_FUNCTION_PATH = '/api/go'

/** Whether env turns the comparison on. */
function compareEnabled(env = process.env) {
  return env.TYPLE_BACKEND_COMPARE === '1'
}

/**
 * The Kotlin service's origin from TYPLE_KOTLIN_URL, without a trailing slash; null when it is not set. Throws when it
 * is not an https URL with only an origin, so a typo fails the build instead of sending requests somewhere else.
 */
function kotlinOrigin(env = process.env) {
  const value = env.TYPLE_KOTLIN_URL
  if (value === undefined || value === '') return null
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`TYPLE_KOTLIN_URL (${value}) は URL にしてください。`)
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new Error(`TYPLE_KOTLIN_URL (${value}) は https:// のオリジンだけにしてください。`)
  }
  return url.origin
}

/** The beforeFiles rewrites of next.config.mjs: none unless the comparison is on. */
function backendRewrites(env = process.env) {
  if (!compareEnabled(env)) return []
  const kotlin = kotlinOrigin(env)
  return COMPARED_PATHS.flatMap((source) => {
    const rules = [{
      source,
      has: [{ type: 'header', key: BACKEND_HEADER, value: 'go' }],
      destination: `${GO_FUNCTION_PATH}?path=${source.slice('/api/'.length)}`,
    }]
    if (kotlin !== null) {
      rules.push({ source, has: [{ type: 'header', key: BACKEND_HEADER, value: 'kotlin' }], destination: `${kotlin}${source}` })
    }
    return rules
  })
}

/**
 * The headers rules of next.config.mjs that mark the Next.js answers with x-typle-backend: next, for the requests that go
 * to Next.js (no header, or next); none unless the comparison is on.
 */
function nextBackendHeaders(env = process.env) {
  if (!compareEnabled(env)) return []
  const headers = [{ key: BACKEND_HEADER, value: 'next' }]
  return COMPARED_PATHS.flatMap((source) => [
    { source, missing: [{ type: 'header', key: BACKEND_HEADER }], headers },
    { source, has: [{ type: 'header', key: BACKEND_HEADER, value: 'next' }], headers },
  ])
}

module.exports = { BACKEND_HEADER, COMPARED_PATHS, compareEnabled, kotlinOrigin, backendRewrites, nextBackendHeaders }

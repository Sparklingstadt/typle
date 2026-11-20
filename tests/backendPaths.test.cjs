const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// Every /api path is a Route Handler (src/app/api/<path>/route.ts) since v2.46.10. The only forwards left are the
// comparison's and the switch to Go (scripts/backendCompare.cjs), which a deployment has only when it is built with
// TYPLE_BACKEND_COMPARE=1 or TYPLE_BACKEND=go.
const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('vercel.json forwards nothing, and next.config.mjs only the comparison', () => {
  assert.equal(JSON.parse(read('vercel.json')).rewrites, undefined)
  assert.match(read('next.config.mjs'), /beforeFiles: backendCompare\.backendRewrites\(\), afterFiles: \[\], fallback: \[\]/)
})

// The paths the apps (Web, iPad, Mac, Android, Windows) call.
const nextRoutes = ['/api/health', '/api/workspace', '/api/workspace/records',
  '/api/auth/session', '/api/auth/token', '/api/auth/signout', '/api/auth/local',
  '/api/auth/signin', '/api/auth/callback/github']

test('every path of the API is a Route Handler', () => {
  for (const route of nextRoutes) assert.ok(fs.existsSync(path.join(root, 'src/app', route, 'route.ts')), `${route} has no route.ts`)
})

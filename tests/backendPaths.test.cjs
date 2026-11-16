const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// Every /api path is a Route Handler (src/app/api/<path>/route.ts) since v2.46.10: nothing is forwarded to the Go
// backend any more, neither by vercel.json on Vercel nor by next.config.mjs locally. A forward left behind would send a
// path to a backend that no longer answers it.
const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('vercel.json and next.config.mjs forward nothing', () => {
  assert.equal(JSON.parse(read('vercel.json')).rewrites, undefined)
  assert.doesNotMatch(read('next.config.mjs'), /rewrites|beforeFiles/)
})

// The paths the apps (Web, iPad, Mac, Android, Windows) call.
const nextRoutes = ['/api/health', '/api/gallery', '/api/gallery/categories', '/api/gallery/added', '/api/gallery/reports', '/api/shared', '/api/shares', '/api/workspace', '/api/workspace/records',
  '/api/auth/session', '/api/auth/token', '/api/auth/signout', '/api/auth/local',
  '/api/auth/signin', '/api/auth/callback/github', '/api/auth/callback/ffpf']

test('every path of the API is a Route Handler', () => {
  for (const route of nextRoutes) assert.ok(fs.existsSync(path.join(root, 'src/app', route, 'route.ts')), `${route} has no route.ts`)
})

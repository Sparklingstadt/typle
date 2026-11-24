const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// Every /api path is a Route Handler (src/app/api/<path>/route.ts) since v2.46.10, and nothing is forwarded to another
// backend: the comparison with Go, Kotlin and Rails (x-typle-backend) and the switch to Go (TYPLE_BACKEND=go) left
// with their code in v2.60.5, for github.com/Sparklingstadt/typle-backends.
const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('neither vercel.json nor next.config.mjs forwards a path', () => {
  assert.equal(JSON.parse(read('vercel.json')).rewrites, undefined)
  assert.doesNotMatch(read('next.config.mjs'), /rewrites|backendCompare|TYPLE_BACKEND/)
})

test('no other backend is left in the repository', () => {
  for (const name of ['server', 'api', 'kotlin', 'rails', 'go.mod', 'go.sum']) {
    assert.ok(!fs.existsSync(path.join(root, name)), `${name} belongs to typle-backends`)
  }
})

// The paths the apps (Web, iPad, Mac, Android, Windows) call. Every /api/auth path is Auth.js's (src/auth.ts).
const nextRoutes = ['/api/health', '/api/workspace', '/api/workspace/records', '/api/auth/[...nextauth]']

test('every path of the API is a Route Handler', () => {
  for (const route of nextRoutes) assert.ok(fs.existsSync(path.join(root, 'src/app', route, 'route.ts')), `${route} has no route.ts`)
})

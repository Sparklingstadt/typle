const assert = require('node:assert/strict')
const test = require('node:test')
const { backendRewrites, nextBackendHeaders, kotlinOrigin, COMPARED_PATHS } = require('../scripts/backendCompare.cjs')

// The comparison of the backends (scripts/backendCompare.cjs): only a deployment built with TYPLE_BACKEND_COMPARE=1
// forwards anything, so x-typle-backend changes nothing in production.

test('without TYPLE_BACKEND_COMPARE=1 nothing is forwarded or marked', () => {
  for (const env of [{}, { TYPLE_BACKEND_COMPARE: '0' }, { TYPLE_BACKEND_COMPARE: 'true' }, { TYPLE_KOTLIN_URL: 'https://k.example' }]) {
    assert.deepEqual(backendRewrites(env), [])
    assert.deepEqual(nextBackendHeaders(env), [])
  }
})

test('the comparison sends x-typle-backend: go to the Go function', () => {
  const rules = backendRewrites({ TYPLE_BACKEND_COMPARE: '1' })
  assert.deepEqual(rules, [
    { source: '/api/health', has: [{ type: 'header', key: 'x-typle-backend', value: 'go' }], destination: '/api/go?path=health' },
    { source: '/api/workspace', has: [{ type: 'header', key: 'x-typle-backend', value: 'go' }], destination: '/api/go?path=workspace' },
    { source: '/api/workspace/records', has: [{ type: 'header', key: 'x-typle-backend', value: 'go' }], destination: '/api/go?path=workspace/records' },
  ])
})

test('with TYPLE_KOTLIN_URL x-typle-backend: kotlin goes to the same path on the Kotlin service', () => {
  const rules = backendRewrites({ TYPLE_BACKEND_COMPARE: '1', TYPLE_KOTLIN_URL: 'https://typle-kotlin-abc.a.run.app/' })
  const kotlin = rules.filter(rule => rule.has[0].value === 'kotlin')
  assert.deepEqual(kotlin.map(rule => rule.destination), COMPARED_PATHS.map(source => `https://typle-kotlin-abc.a.run.app${source}`))
  assert.equal(rules.length, COMPARED_PATHS.length * 2)
})

test('TYPLE_KOTLIN_URL must be an https origin', () => {
  assert.equal(kotlinOrigin({}), null)
  assert.equal(kotlinOrigin({ TYPLE_KOTLIN_URL: '' }), null)
  for (const value of ['http://k.example', 'https://k.example/api', 'https://k.example/?x=1', 'k.example', 'https://u:p@k.example']) {
    assert.throws(() => kotlinOrigin({ TYPLE_KOTLIN_URL: value }), /TYPLE_KOTLIN_URL/, value)
  }
})

test('the Next.js answers are marked only for the requests that go to Next.js', () => {
  const rules = nextBackendHeaders({ TYPLE_BACKEND_COMPARE: '1' })
  assert.equal(rules.length, COMPARED_PATHS.length * 2)
  for (const rule of rules) assert.deepEqual(rule.headers, [{ key: 'x-typle-backend', value: 'next' }])
  assert.ok(rules.every(rule => (rule.missing?.[0].key === 'x-typle-backend') !== (rule.has?.[0].value === 'next')))
})

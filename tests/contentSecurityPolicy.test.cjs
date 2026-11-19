require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { scriptPolicy, sentryReportUri } = require('../src/lib/contentSecurityPolicy.ts')

test('only scripts with the nonce, and the scripts they load, may run', () => {
  assert.equal(scriptPolicy('abc', false, null), "script-src 'self' 'nonce-abc' 'strict-dynamic'; object-src 'none'; base-uri 'self'")
})

test('development also allows eval for React', () => {
  assert.match(scriptPolicy('abc', true, null), /^script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval';/)
})

test('reports go to the given address', () => {
  assert.match(scriptPolicy('abc', false, 'https://r.example/x'), /; report-uri https:\/\/r\.example\/x$/)
})

test('the Sentry DSN gives its security endpoint', () => {
  assert.equal(sentryReportUri('https://k3y@o12.ingest.sentry.io/345'), 'https://o12.ingest.sentry.io/api/345/security/?sentry_key=k3y')
})

test('a missing or unreadable DSN gives no endpoint', () => {
  for (const dsn of [undefined, '', 'not a url', 'http://k@o1.ingest.sentry.io/2', 'https://o1.ingest.sentry.io/2', 'https://k@o1.ingest.sentry.io/x']) {
    assert.equal(sentryReportUri(dsn), null, String(dsn))
  }
})

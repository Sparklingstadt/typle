require('./register.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { decodeLists } = require('../src/lib/wordLists.ts')
const { localDevelopmentEnabled } = require('../src/lib/localDevelopment.ts')

test('local login requires explicit development opt-in, secret and loopback URL', () => {
  const env = { NODE_ENV: 'development', LOCAL_DEVELOPMENT_LOGIN: '1', AUTH_SECRET: 'test-only', AUTH_URL: 'http://localhost:3000' }
  assert.equal(localDevelopmentEnabled(env), true)
  for (const patch of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { LOCAL_DEVELOPMENT_LOGIN: '0' }, { AUTH_SECRET: '' }, { AUTH_URL: 'https://example.com' }, { AUTH_URL: 'http://localhost.example.com' }, { AUTH_URL: '' }]) {
    assert.equal(localDevelopmentEnabled({ ...env, ...patch }), false)
  }
})

test('LAN login only permits an explicitly selected private IPv4 in development', () => {
  const env = { NODE_ENV: 'development', LOCAL_DEVELOPMENT_LOGIN: '1', AUTH_SECRET: 'test-only', AUTH_URL: 'http://192.168.3.49:3000', LOCAL_DEVELOPMENT_LAN_HOST: '192.168.3.49' }
  assert.equal(localDevelopmentEnabled(env), true)
  for (const patch of [{ NODE_ENV: 'production' }, { LOCAL_DEVELOPMENT_LAN_HOST: '' }, { LOCAL_DEVELOPMENT_LAN_HOST: '192.168.3.50' }, { AUTH_URL: 'http://8.8.8.8:3000', LOCAL_DEVELOPMENT_LAN_HOST: '8.8.8.8' }, { AUTH_URL: 'http://172.32.0.1:3000', LOCAL_DEVELOPMENT_LAN_HOST: '172.32.0.1' }]) {
    assert.equal(localDevelopmentEnabled({ ...env, ...patch }), false)
  }
})

test('record and list IDs work without secure-context randomUUID', () => {
  const { randomId } = require('../src/lib/randomId.ts')
  const source = { getRandomValues: array => crypto.webcrypto.getRandomValues(array) }
  const ids = Array.from({ length: 100 }, () => randomId(source))
  assert.equal(new Set(ids).size, 100)
  for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
})

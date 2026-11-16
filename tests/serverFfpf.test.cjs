require('./register.cjs')
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('node:crypto')
const { ffpfAuthorizeUrl, exchangeFfpfCode, FfpfError, newJwksCache } = require('../src/server/ffpf.ts')

// "Sign in with FFPF ID", as the Go backend's auth.FFPF did it (its tests, server/internal/auth/ffpf_test.go, are copied
// here): the authorization code flow with PKCE, client_secret_basic, and an ES256 ID token checked against the portal's
// JWKS and the claims.

const CLIENT_ID = 'typle-r'
const CLIENT_SECRET = 'the-client-secret'
const NONCE = 'the-nonce'
const REDIRECT_URI = 'https://app.example/api/auth/callback/ffpf'
const b64 = data => Buffer.from(data).toString('base64url')

const newKey = () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
function jwk(key, kid) {
  const { x, y } = key.publicKey.export({ format: 'jwk' })
  return { kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid, x, y }
}
function signJwt(key, header, claims) {
  const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`
  return `${input}.${b64(crypto.sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }))}`
}
const signIdToken = (key, kid, claims) => signJwt(key, { alg: 'ES256', typ: 'JWT', kid }, claims)

const servers = []
after(() => { for (const server of servers) server.close() })

/** A portal with /oauth/token and /oauth/jwks; set changes what they answer. */
async function portal() {
  const state = { idToken: '', jwks: [], jwksFails: false, token: null, tokenCalls: 0, jwksCalls: 0, requests: [] }
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      state.requests.push({ method: request.method, url: request.url, headers: request.headers, body })
      if (request.url === '/oauth/token') {
        state.tokenCalls++
        if (state.token) return state.token(request, response)
        response.setHeader('Content-Type', 'application/json')
        return response.end(JSON.stringify({ access_token: 'the-access-token', token_type: 'Bearer', expires_in: 300, id_token: state.idToken }))
      }
      if (request.url === '/oauth/jwks') {
        state.jwksCalls++
        if (state.jwksFails) { response.statusCode = 500; return response.end() }
        return response.end(JSON.stringify({ keys: state.jwks }))
      }
      response.statusCode = 404
      response.end()
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const issuer = `http://127.0.0.1:${server.address().port}`
  const settings = { issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }
  const now = Math.floor(Date.now() / 1000)
  const claims = () => ({
    iss: issuer, aud: CLIENT_ID, sub: 'cabc', exp: now + 300, iat: now, nonce: NONCE, email: 'a@example.com', email_verified: true, name: 'ふわ',
  })
  const cache = newJwksCache()
  const exchange = (at = now) => exchangeFfpfCode(settings, 'the-code', 'the-verifier', REDIRECT_URI, NONCE, at, cache)
  return { state, issuer, settings, claims, exchange, server, now }
}

const rejected = error => error instanceof FfpfError && error.kind === 'rejected'
const unavailable = error => error instanceof FfpfError && error.kind === 'unavailable'

test('the authorize URL', () => {
  const settings = { issuer: 'https://portal.example', clientId: 'client-id', clientSecret: 'client-secret' }
  assert.equal(ffpfAuthorizeUrl(settings, 'the state', 'the challenge', 'the nonce', REDIRECT_URI, false),
    'https://portal.example/oauth/authorize?client_id=client-id&code_challenge=the+challenge&code_challenge_method=S256&nonce=the+nonce' +
    '&redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fauth%2Fcallback%2Fffpf&response_type=code&scope=openid+email+profile&state=the+state')
  assert.match(ffpfAuthorizeUrl(settings, 's', 'c', 'n', REDIRECT_URI, true), /&prompt=login&redirect_uri=/)
})

test('a valid exchange: client_secret_basic, the form, and the user of the ID token', async () => {
  const p = await portal()
  const key = newKey()
  p.state.jwks = [jwk(key, 'k1')]
  p.state.idToken = signIdToken(key, 'k1', p.claims())
  assert.deepEqual(await p.exchange(), { sub: 'cabc', email: 'a@example.com', name: 'ふわ' })
  const token = p.state.requests.find(r => r.url === '/oauth/token')
  assert.equal(token.method, 'POST')
  assert.equal(token.headers.accept, 'application/json')
  assert.equal(token.headers['content-type'], 'application/x-www-form-urlencoded')
  assert.equal(token.headers.authorization, `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`)
  assert.equal(token.body, 'code=the-code&code_verifier=the-verifier&grant_type=authorization_code&redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fauth%2Fcallback%2Fffpf')
  assert.deepEqual([p.state.tokenCalls, p.state.jwksCalls], [1, 1])
})

test('the Basic credentials are query-escaped first (RFC 6749 §2.3.1)', async () => {
  const p = await portal()
  const key = newKey()
  p.state.jwks = [jwk(key, 'k1')]
  p.state.idToken = signIdToken(key, 'k1', { ...p.claims(), aud: 'typle r' })
  await exchangeFfpfCode({ ...p.settings, clientId: 'typle r', clientSecret: 's:e/c' }, 'c', 'v', REDIRECT_URI, NONCE, p.now, newJwksCache())
  assert.equal(p.state.requests[0].headers.authorization, `Basic ${Buffer.from('typle+r:s%3Ae%2Fc').toString('base64')}`)
})

test('accepted variations of a valid ID token', async () => {
  const cases = {
    'exp 59 seconds ago': [c => ({ ...c, exp: c.iat - 59 }), 'ふわ'],
    'aud as an array': [c => ({ ...c, aud: ['other', CLIENT_ID] }), 'ふわ'],
    'aud array with null': [c => ({ ...c, aud: [null, CLIENT_ID] }), 'ふわ'],
    'no name': [({ name, ...c }) => c, 'a'],
    'blank name': [c => ({ ...c, name: '　 ' }), 'a'],
    'name trimmed': [c => ({ ...c, name: ' Erin\u0085' }), 'Erin'],
    'typ null': [c => c, 'ふわ', { alg: 'ES256', typ: null, kid: 'k1' }],
    'no typ': [c => c, 'ふわ', { alg: 'ES256', kid: 'k1' }],
  }
  for (const [name, [change, want, header]] of Object.entries(cases)) {
    const p = await portal()
    const key = newKey()
    p.state.jwks = [jwk(key, 'k1')]
    p.state.idToken = signJwt(key, header ?? { alg: 'ES256', typ: 'JWT', kid: 'k1' }, change(p.claims()))
    assert.deepEqual(await p.exchange(), { sub: 'cabc', email: 'a@example.com', name: want }, name)
  }
})

test('an ID token that is not the app\'s is rejected', async () => {
  const other = newKey()
  const cases = {
    'other iss': (p, key) => signIdToken(key, 'k1', { ...p.claims(), iss: p.issuer + '/other' }),
    'iss with a trailing slash': (p, key) => signIdToken(key, 'k1', { ...p.claims(), iss: p.issuer + '/' }),
    'other aud': (p, key) => signIdToken(key, 'k1', { ...p.claims(), aud: 'other' }),
    'aud array without the client': (p, key) => signIdToken(key, 'k1', { ...p.claims(), aud: ['other'] }),
    'aud array with a number': (p, key) => signIdToken(key, 'k1', { ...p.claims(), aud: [1, CLIENT_ID] }),
    'no aud': (p, key) => { const { aud, ...c } = p.claims(); return signIdToken(key, 'k1', c) },
    'exp 61 seconds ago': (p, key) => signIdToken(key, 'k1', { ...p.claims(), exp: p.now - 61 }),
    'no exp': (p, key) => { const { exp, ...c } = p.claims(); return signIdToken(key, 'k1', c) },
    'exp as a string': (p, key) => signIdToken(key, 'k1', { ...p.claims(), exp: '9999999999' }),
    'exp negative': (p, key) => signIdToken(key, 'k1', { ...p.claims(), exp: -1 }),
    'exp beyond 2^53': (p, key) => signIdToken(key, 'k1', { ...p.claims(), exp: 2 ** 53 + 2 }),
    'other nonce': (p, key) => signIdToken(key, 'k1', { ...p.claims(), nonce: 'other' }),
    'no nonce': (p, key) => { const { nonce, ...c } = p.claims(); return signIdToken(key, 'k1', c) },
    'email_verified false': (p, key) => signIdToken(key, 'k1', { ...p.claims(), email_verified: false }),
    'email_verified as a string': (p, key) => signIdToken(key, 'k1', { ...p.claims(), email_verified: 'true' }),
    'no email': (p, key) => { const { email, ...c } = p.claims(); return signIdToken(key, 'k1', c) },
    'email not a string': (p, key) => signIdToken(key, 'k1', { ...p.claims(), email: 1 }),
    'signed with another key': p => signIdToken(other, 'k1', p.claims()),
    'alg none': (p, key) => { const token = signJwt(key, { alg: 'none', kid: 'k1' }, p.claims()); return token.slice(0, token.lastIndexOf('.') + 1) },
    'alg none with a signature': (p, key) => signJwt(key, { alg: 'none', kid: 'k1' }, p.claims()),
    'alg HS256': (p, key) => signJwt(key, { alg: 'HS256', kid: 'k1' }, p.claims()),
    'typ other': (p, key) => signJwt(key, { alg: 'ES256', typ: 'at+jwt', kid: 'k1' }, p.claims()),
    'no kid': (p, key) => signJwt(key, { alg: 'ES256', typ: 'JWT' }, p.claims()),
    'header not an object': (p, key) => { const token = signIdToken(key, 'k1', p.claims()); return `${b64('[1]')}.${token.split('.').slice(1).join('.')}` },
    'sub A/B': (p, key) => signIdToken(key, 'k1', { ...p.claims(), sub: 'A/B' }),
    'sub too long': (p, key) => signIdToken(key, 'k1', { ...p.claims(), sub: 'a'.repeat(65) }),
    'no sub': (p, key) => { const { sub, ...c } = p.claims(); return signIdToken(key, 'k1', c) },
    'four segments': (p, key) => signIdToken(key, 'k1', p.claims()) + '.x',
    'padded signature': (p, key) => signIdToken(key, 'k1', p.claims()) + '=',
    'short signature': (p, key) => { const token = signIdToken(key, 'k1', p.claims()); return token.slice(0, token.lastIndexOf('.') + 1) + b64(Buffer.alloc(63)) },
    'not a JWT': () => 'not a jwt',
  }
  for (const [name, makeToken] of Object.entries(cases)) {
    const p = await portal()
    const key = newKey()
    p.state.jwks = [jwk(key, 'k1')]
    p.state.idToken = makeToken(p, key)
    await assert.rejects(p.exchange(), rejected, name)
  }
})

test('a token endpoint that refuses, or answers without an ID token, is rejected', async () => {
  const answers = {
    'token 400': (request, response) => { response.statusCode = 400; response.end('{"error":"invalid_grant"}') },
    'token 401': (request, response) => { response.statusCode = 401; response.end('{"error":"invalid_client"}') },
    'no id_token': (request, response) => response.end('{"access_token":"a","token_type":"Bearer"}'),
    'empty id_token': (request, response) => response.end('{"id_token":""}'),
    'null id_token': (request, response) => response.end('{"id_token":null}'),
    'id_token not a string': (request, response) => response.end('{"id_token":1}'),
    'not JSON': (request, response) => response.end('<html>'),
  }
  for (const [name, answer] of Object.entries(answers)) {
    const p = await portal()
    p.state.token = answer
    await assert.rejects(p.exchange(), rejected, name)
  }
  const p = await portal()
  p.state.token = (request, response) => { response.statusCode = 400; response.end('{"error":"invalid_grant"}') }
  await assert.rejects(p.exchange(), error => rejected(error) && error.message.includes('400 invalid_grant'))
})

test('a portal that does not answer, or answers 5xx or 3xx, is unavailable, and no secret is in the error', async () => {
  const setups = {
    'token 502': p => { p.state.token = (request, response) => { response.statusCode = 502; response.end() } },
    'token 3xx': p => { p.state.token = (request, response) => { response.statusCode = 307; response.setHeader('Location', p.issuer + '/elsewhere'); response.end() } },
    'jwks 500': p => { p.state.jwksFails = true },
  }
  const noSecret = error => unavailable(error) && !['the-client-secret', 'the-code', 'the-verifier'].some(s => error.message.includes(s))
  for (const [name, setup] of Object.entries(setups)) {
    const p = await portal()
    const key = newKey()
    p.state.jwks = [jwk(key, 'k1')]
    p.state.idToken = signIdToken(key, 'k1', p.claims())
    setup(p)
    await assert.rejects(p.exchange(), noSecret, name)
  }
  const p = await portal()
  await new Promise(resolve => p.server.close(resolve))
  await assert.rejects(p.exchange(), noSecret)
})

test('the JWKS is fetched again for an unknown kid, once per token', async () => {
  const p = await portal()
  const [first, second, unknown] = [newKey(), newKey(), newKey()]
  p.state.jwks = [jwk(first, 'k1')]
  p.state.idToken = signIdToken(first, 'k1', p.claims())
  await p.exchange()
  p.state.jwks = [jwk(second, 'k2')]
  p.state.idToken = signIdToken(second, 'k2', p.claims())
  assert.equal((await p.exchange()).sub, 'cabc')
  assert.equal(p.state.jwksCalls, 2)
  p.state.idToken = signIdToken(unknown, 'k3', p.claims())
  await assert.rejects(p.exchange(), rejected)
  assert.equal(p.state.jwksCalls, 3)
})

test('the JWKS is kept for 10 minutes', async () => {
  const p = await portal()
  const key = newKey()
  p.state.jwks = [jwk(key, 'k1')]
  p.state.idToken = signIdToken(key, 'k1', { ...p.claims(), exp: p.now + 3600 })
  for (let i = 0; i < 3; i++) await p.exchange(p.now + i * 100)
  assert.equal(p.state.jwksCalls, 1)
  await p.exchange(p.now + 599)
  assert.equal(p.state.jwksCalls, 1)
  await p.exchange(p.now + 601)
  assert.equal(p.state.jwksCalls, 2)
})

test('keys that are not P-256 EC signing keys, or are off the curve, are left out', async () => {
  const p = await portal()
  const key = newKey()
  const offCurve = { ...jwk(key, 'k1'), y: b64(Buffer.alloc(32)) }
  p.state.jwks = [
    { kty: 'RSA', kid: 'k1', n: 'AQAB', e: 'AQAB' },
    { kty: 'EC', crv: 'P-384', kid: 'k1', x: b64(Buffer.alloc(48)), y: b64(Buffer.alloc(48)) },
    { ...jwk(key, 'k1'), use: 'enc' },
    { ...jwk(key, 'k1'), x: jwk(key, 'k1').x + '=' },
    offCurve,
  ]
  p.state.idToken = signIdToken(key, 'k1', p.claims())
  await assert.rejects(p.exchange(), rejected)
  p.state.jwks = [...p.state.jwks, jwk(key, 'k1')]
  assert.equal((await p.exchange()).sub, 'cabc')
})

test('a JWKS that is not JSON with keys is unavailable', async () => {
  for (const body of ['<html>', '{}', '{"keys":null}', '{"keys":[1]}', '{"keys":[{"kid":1}]}']) {
    const p = await portal()
    const key = newKey()
    p.state.idToken = signIdToken(key, 'k1', p.claims())
    p.server.removeAllListeners('request')
    p.server.on('request', (request, response) => {
      request.resume()
      request.on('end', () => {
        if (request.url === '/oauth/jwks') return response.end(body)
        response.end(JSON.stringify({ id_token: p.state.idToken }))
      })
    })
    await assert.rejects(p.exchange(), unavailable, body)
  }
})

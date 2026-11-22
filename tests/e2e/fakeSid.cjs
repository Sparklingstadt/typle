const http = require('node:http')
const { createHash, generateKeyPairSync, randomBytes, sign } = require('node:crypto')

// A fake Sparklingstadt ID for the end-to-end tests, started by playwright.config.ts as a webServer: the OpenID
// Connect provider the app's sid login talks to (AUTH_SID_ISSUER). It signs nobody in: /authorize answers at once with a
// code for the identity set by POST /next ({ sub, email, email_verified, name }), and records its query, which GET
// /requests answers (newest last) so that a test can see the prompt the app sent. /token checks the client (e2e:e2e,
// client_secret_basic) and the PKCE verifier, and answers an ES256 ID token carrying the nonce, whose access token
// /userinfo answers the same identity for. Kept in memory.
const port = Number(process.env.FAKE_SID_PORT || 3197)
const issuer = `http://127.0.0.1:${port}`
const CLIENT = { id: 'e2e', secret: 'e2e' }
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const kid = 'e2e'
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' }

let next = { sub: 'e2edefault', email: 'e2e@example.test', email_verified: true, name: 'E2E' }
const requests = []
const codes = new Map()
const accessTokens = new Map()

const base64url = value => Buffer.from(value).toString('base64url')
function idToken(claims) {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }))
  const payload = base64url(JSON.stringify(claims))
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' })
  return `${header}.${payload}.${signature.toString('base64url')}`
}

const readBody = request => new Promise(resolve => {
  let data = ''
  request.on('data', chunk => { data += chunk })
  request.on('end', () => resolve(data))
})

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', issuer)
  const answer = (status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  if (url.pathname === '/.well-known/openid-configuration') {
    return answer(200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      userinfo_endpoint: `${issuer}/userinfo`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['ES256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
      prompt_values_supported: ['none', 'login'],
    })
  }
  if (url.pathname === '/jwks') return answer(200, { keys: [jwk] })
  if (url.pathname === '/next' && request.method === 'POST') {
    next = JSON.parse(await readBody(request))
    return answer(200, next)
  }
  if (url.pathname === '/requests') return answer(200, requests)
  if (url.pathname === '/authorize') {
    const query = Object.fromEntries(url.searchParams)
    requests.push(query)
    if (query.client_id !== CLIENT.id || query.response_type !== 'code' || query.code_challenge_method !== 'S256') {
      return answer(400, { error: 'invalid_request' })
    }
    const code = randomBytes(16).toString('base64url')
    codes.set(code, { identity: next, nonce: query.nonce, challenge: query.code_challenge, redirectUri: query.redirect_uri })
    const back = new URL(query.redirect_uri)
    back.searchParams.set('code', code)
    if (query.state) back.searchParams.set('state', query.state)
    back.searchParams.set('iss', issuer)
    response.writeHead(302, { Location: back.href })
    return response.end()
  }
  if (url.pathname === '/token' && request.method === 'POST') {
    const form = new URLSearchParams(await readBody(request))
    const [id, secret] = Buffer.from((request.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString().split(':')
    if (decodeURIComponent(id ?? '') !== CLIENT.id || decodeURIComponent(secret ?? '') !== CLIENT.secret) {
      return answer(401, { error: 'invalid_client' })
    }
    const pending = codes.get(form.get('code') ?? '')
    codes.delete(form.get('code') ?? '')
    const verifier = form.get('code_verifier') ?? ''
    if (!pending || pending.redirectUri !== form.get('redirect_uri')
      || createHash('sha256').update(verifier).digest('base64url') !== pending.challenge) {
      return answer(400, { error: 'invalid_grant' })
    }
    const now = Math.floor(Date.now() / 1000)
    const { identity } = pending
    const accessToken = randomBytes(16).toString('base64url')
    accessTokens.set(accessToken, identity)
    return answer(200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 300,
      id_token: idToken({ iss: issuer, aud: CLIENT.id, iat: now, exp: now + 300, auth_time: now, nonce: pending.nonce, ...identity }),
    })
  }
  if (url.pathname === '/userinfo') {
    const identity = accessTokens.get((request.headers.authorization ?? '').replace(/^Bearer /, ''))
    return identity ? answer(200, identity) : answer(401, { error: 'invalid_token' })
  }
  answer(404, { error: 'not_found' })
})

server.listen(port, '127.0.0.1')

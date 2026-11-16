import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import { encodeValues, queryEscape, trimSpace } from './goUrl'
import { causeOf, parseJson, providerFetch, readBody, readFields } from './provider'
import { strictBase64url } from './session'
import type { FfpfSettings } from './settings'

// "Sign in with FFPF ID", as the Go backend's auth.FFPF did it: the OpenID Connect provider run by ffpf-portal, with the
// authorization code flow and PKCE. Its endpoints are built from the issuer (no discovery), the client secret is sent
// only to the token endpoint with HTTP Basic auth (client_secret_basic), and the ID token that comes back is checked
// here: an ES256 signature by a key of the portal's JWKS, and its iss, aud, exp, nonce, email_verified and sub. The access
// token is not used, as the ID token says all the app needs.

/** An FFPF ID account, as its checked ID token describes it. */
export type FfpfUser = { sub: string, email: string, name: string }

/**
 * Why the login failed: rejected is FFPF ID refusing it (the token endpoint answered 4xx, or the ID token is not one this
 * app accepts), and trying again with the same code will not help; unavailable is FFPF ID not answering, answering 5xx,
 * or its JWKS not being had, and it may work later.
 */
export class FfpfError extends Error {
  constructor(readonly kind: 'rejected' | 'unavailable', message: string) {
    super(message)
    this.name = 'FfpfError'
  }
}

/** The JWKS is trusted this long, so most logins need one call to the portal, not two. */
const JWKS_CACHE_SECONDS = 600
/** An ID token is still accepted this long after its exp, for clocks that do not quite agree. */
const LEEWAY_SECONDS = 60
/** The form of an FFPF ID subject, which becomes part of the account id ffpf:<sub>. */
const FFPF_SUB = /^[a-z0-9]{1,64}$/
/** One base64url segment of a compact JWT. */
const JWT_SEGMENT = /^[A-Za-z0-9_-]+$/
/** An RFC 6749 error code, the only part of a refusal that is logged. */
const OAUTH_ERROR_CODE = /^[a-z_]{1,64}$/

/** The portal's P-256 keys by kid, and when they were fetched (Unix seconds). */
export type JwksCache = { keys: Map<string, KeyObject>, fetchedAt: number | null }

export const newJwksCache = (): JwksCache => ({ keys: new Map(), fetchedAt: null })

/** The cache of each issuer, kept for the life of the server instance, as the Go backend kept its one. */
const caches = new Map<string, JwksCache>()
function cacheOf(issuer: string): JwksCache {
  let cache = caches.get(issuer)
  if (!cache) caches.set(issuer, cache = newJwksCache())
  return cache
}

/**
 * Where to send the browser to sign in. challenge is the S256 challenge of the verifier later traded, and nonce the one the
 * ID token must echo. With login the portal asks for the password even when the browser is still signed in to it.
 */
export function ffpfAuthorizeUrl(ffpf: FfpfSettings, state: string, challenge: string, nonce: string, redirectUri: string, login: boolean): string {
  const query: Record<string, string> = {
    client_id: ffpf.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce,
    code_challenge: challenge, code_challenge_method: 'S256',
  }
  if (login) query.prompt = 'login'
  return `${ffpf.issuer}/oauth/authorize?${encodeValues(query)}`
}

/**
 * Trades the code the portal sent back for the user's checked ID token, and returns who it names. verifier, redirectUri
 * and nonce are the ones the authorize URL was given; now (Unix seconds) is the clock of exp and of the JWKS cache. The
 * error is an FfpfError, and never has the client secret, the code, the verifier or a token in its message.
 */
export async function exchangeFfpfCode(ffpf: FfpfSettings, code: string, verifier: string, redirectUri: string, nonce: string,
  now: number = Date.now() / 1000, cache: JwksCache = cacheOf(ffpf.issuer)): Promise<FfpfUser> {
  const idToken = await requestIdToken(ffpf, code, verifier, redirectUri)
  const { segments, decoded } = splitJwt(idToken)
  await checkSignature(ffpf, segments, decoded, now, cache)
  return readClaims(ffpf, decoded[1], nonce, now)
}

/** The POST to the token endpoint, and the ID token of its answer. */
async function requestIdToken(ffpf: FfpfSettings, code: string, verifier: string, redirectUri: string): Promise<string> {
  // RFC 6749 §2.3.1 has the client id and secret form-encoded before they are put in the Basic credentials.
  const credentials = Buffer.from(`${queryEscape(ffpf.clientId)}:${queryEscape(ffpf.clientSecret)}`).toString('base64')
  let response: Response
  try {
    response = await providerFetch(`${ffpf.issuer}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: encodeValues({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
  } catch (error) {
    throw new FfpfError('unavailable', `FFPF ID could not be reached: the token request failed: ${causeOf(error)}`)
  }
  const { status } = response
  if (status >= 400 && status <= 499) {
    // The portal refused the code or the client. Only the error code is kept, and only if it looks like one.
    const refusal = readFields(parseJson(await readBody(response)), { error: 'string' })?.error ?? ''
    throw new FfpfError('rejected', `FFPF ID refused the login: the token endpoint answered ${status}${OAUTH_ERROR_CODE.test(refusal) ? ` ${refusal}` : ''}`)
  }
  if (status < 200 || status > 299) {
    await response.body?.cancel()
    throw new FfpfError('unavailable', `FFPF ID could not be reached: the token endpoint answered ${status}`)
  }
  const body = readFields(parseJson(await readBody(response)), { id_token: 'string' })
  if (!body) throw new FfpfError('rejected', 'FFPF ID refused the login: the token answer is not JSON with a string id_token')
  if (!body.id_token) throw new FfpfError('rejected', 'FFPF ID refused the login: the token answer has no id_token')
  return body.id_token
}

const rejected = (reason: string) => new FfpfError('rejected', `FFPF ID refused the login: the ID token ${reason}`)

/** The three segments of a compact JWT, each decoded from strict base64url. */
function splitJwt(idToken: string): { segments: string[], decoded: Buffer[] } {
  const segments = idToken.split('.')
  if (segments.length !== 3) throw rejected('is not a compact JWT')
  const decoded = segments.map(segment => JWT_SEGMENT.test(segment) ? strictBase64url(segment) : null)
  if (decoded.some(data => data === null)) throw rejected('is not a compact JWT')
  return { segments, decoded: decoded as Buffer[] }
}

/** Checks the JWT's header, and its signature with the key of the portal's JWKS that the header names. */
async function checkSignature(ffpf: FfpfSettings, segments: string[], decoded: Buffer[], now: number, cache: JwksCache): Promise<void> {
  const header = readFields(parseJson(decoded[0].toString('utf8')), { alg: 'string', typ: 'string', kid: 'string' })
  if (!header) throw rejected('header is not JSON')
  // Only ES256 is accepted, whatever the header claims, so neither "none" nor an HMAC keyed with the public key can get in.
  if (header.alg !== 'ES256') throw rejected('is not ES256')
  if (header.typ !== undefined && header.typ !== 'JWT') throw rejected('is not typed JWT')
  if (!header.kid) throw rejected('has no kid')
  const key = await keyOf(ffpf, header.kid, now, cache)
  // An ES256 signature is r‖s, 32 bytes each (RFC 7518 §3.4), not ASN.1.
  if (decoded[2].length !== 64) throw rejected('signature is not 64 bytes')
  const signed = Buffer.from(`${segments[0]}.${segments[1]}`)
  if (!verify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, decoded[2])) throw rejected('signature does not verify')
}

/** Whether aud, a string or an array of strings (RFC 7519 §4.1.3), names the client. */
function audienceHas(aud: unknown, clientId: string): boolean {
  if (typeof aud === 'string') return aud === clientId
  if (!Array.isArray(aud) || !aud.every(a => a === null || typeof a === 'string')) return false
  return aud.includes(clientId)
}

/** Checks the claims of a signed ID token, and returns who they name. */
function readClaims(ffpf: FfpfSettings, payload: Buffer, nonce: string, now: number): FfpfUser {
  const claims = readFields(parseJson(payload.toString('utf8')), {
    iss: 'string', aud: 'raw', exp: 'number', nonce: 'string', sub: 'string', email: 'string', email_verified: 'raw', name: 'string',
  })
  if (!claims) throw rejected('claims are not JSON of the expected types')
  if ((claims.iss ?? '') !== ffpf.issuer) throw rejected('is from another issuer')
  if (!audienceHas(claims.aud, ffpf.clientId)) throw rejected('is for another client')
  // exp is seconds since 1970; one beyond 2^53 is not a time a portal would mean.
  if (claims.exp === undefined || claims.exp < 0 || claims.exp > 2 ** 53) throw rejected('has no usable exp')
  if (now > Math.trunc(claims.exp) + LEEWAY_SECONDS) throw rejected('has expired')
  if (nonce === '' || claims.nonce !== nonce) throw rejected('has another nonce')
  if (claims.email_verified !== true) throw rejected('email is not verified')
  if (!claims.email) throw rejected('has no email')
  if (!FFPF_SUB.test(claims.sub ?? '')) throw rejected('sub is not of the expected form')
  // The portal's name may be empty; the part of the email before "@" is shown instead.
  const name = trimSpace(claims.name ?? '') || claims.email.split('@')[0]
  return { sub: claims.sub as string, email: claims.email, name }
}

/**
 * The portal's public key of kid. The JWKS is fetched when the cache is older than JWKS_CACHE_SECONDS, or when it does
 * not have kid (the portal may have a new key), but at most once per call. A kid the fresh JWKS does not have either is
 * rejected.
 */
async function keyOf(ffpf: FfpfSettings, kid: string, now: number, cache: JwksCache): Promise<KeyObject> {
  const fresh = cache.fetchedAt !== null && now - cache.fetchedAt < JWKS_CACHE_SECONDS
  const cached = cache.keys.get(kid)
  if (cached && fresh) return cached
  const keys = await fetchJwks(ffpf)
  cache.keys = keys
  cache.fetchedAt = now
  const key = keys.get(kid)
  if (!key) throw new FfpfError('rejected', 'FFPF ID refused the login: the ID token\'s kid is not in the JWKS')
  return key
}

/**
 * GET <issuer>/oauth/jwks. Keys that are not P-256 EC signing keys with a kid, or whose point is not on the curve, are
 * left out; anything that goes wrong with the request is unavailable.
 */
async function fetchJwks(ffpf: FfpfSettings): Promise<Map<string, KeyObject>> {
  let response: Response
  try {
    response = await providerFetch(`${ffpf.issuer}/oauth/jwks`, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw new FfpfError('unavailable', `FFPF ID could not be reached: the JWKS request failed: ${causeOf(error)}`)
  }
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new FfpfError('unavailable', `FFPF ID could not be reached: the JWKS endpoint answered ${response.status}`)
  }
  const notKeys = new FfpfError('unavailable', 'FFPF ID could not be reached: the JWKS is not JSON with keys')
  const body = readFields(parseJson(await readBody(response)), { keys: 'raw' })
  if (!body || !Array.isArray(body.keys)) throw notKeys
  const entries = body.keys.map(entry => readFields(entry, { kty: 'string', crv: 'string', use: 'string', kid: 'string', x: 'string', y: 'string' }))
  if (entries.some(entry => entry === null)) throw notKeys
  const keys = new Map<string, KeyObject>()
  for (const entry of entries) {
    const { kty, crv, use, kid, x, y } = entry!
    if (kty !== 'EC' || crv !== 'P-256' || !kid || (use && use !== 'sig') || keys.has(kid)) continue
    const key = p256Key(x ?? '', y ?? '')
    if (key) keys.set(kid, key)
  }
  return keys
}

/** The public key of a JWK's x and y, if they are 32 bytes each and the point is on P-256 (createPublicKey checks it). */
function p256Key(x: string, y: string): KeyObject | null {
  const xBytes = strictBase64url(x)
  const yBytes = strictBase64url(y)
  if (!xBytes || !yBytes || xBytes.length !== 32 || yBytes.length !== 32) return null
  try {
    return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x, y }, format: 'jwk' })
  } catch {
    return null
  }
}

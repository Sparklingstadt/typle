import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

// Passwords are kept as scrypt hashes: scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>.

const N = 32768
const R = 8
const P = 1
const SALT_BYTES = 16
const KEY_BYTES = 64
const MAXMEM = 64 * 1024 * 1024

/** The scrypt call; injectable for tests only (to count how many times it ran). */
export type Scrypt = (password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

const nodeScrypt: Scrypt = (password, salt, keyLength, options) =>
  new Promise((resolve, reject) => scrypt(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key))))

/** The hash of password under a fresh random salt. */
export async function hashPassword(password: string, derive: Scrypt = nodeScrypt): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAXMEM })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

// What is compared when there is no stored hash (or it is unreadable), so the time taken does not tell an unknown ID
// from a wrong password.
const DUMMY = { N, r: R, p: P, salt: Buffer.alloc(SALT_BYTES, 1), key: Buffer.alloc(KEY_BYTES, 2) }

/** The salt and hash of a stored string, or null unless every parameter is exactly what hashPassword writes. */
function parse(stored: string | null) {
  if (stored === null) return null
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  if (parts[1] !== String(N) || parts[2] !== String(R) || parts[3] !== String(P)) return null
  const salt = Buffer.from(parts[4], 'base64url')
  const key = Buffer.from(parts[5], 'base64url')
  if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null
  return { N, r: R, p: P, salt, key }
}

/**
 * Whether password matches stored. scrypt runs exactly once whatever stored is (null and unreadable ones, including
 * any with parameters other than hashPassword's, run against a fixed dummy and give false).
 */
export async function verifyPassword(password: string, stored: string | null, derive: Scrypt = nodeScrypt): Promise<boolean> {
  const hash = parse(stored)
  const target = hash ?? DUMMY
  const options = { N: target.N, r: target.r, p: target.p, maxmem: MAXMEM }
  let key: Buffer
  try {
    key = await derive(password, target.salt, target.key.length, options)
  } catch {
    // Still spend the one scrypt run before refusing.
    await derive(password, DUMMY.salt, DUMMY.key.length, { N: DUMMY.N, r: DUMMY.r, p: DUMMY.p, maxmem: MAXMEM }).catch(() => undefined)
    return false
  }
  return key.length === target.key.length && timingSafeEqual(key, target.key) && hash !== null
}

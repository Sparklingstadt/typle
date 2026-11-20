import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

// Passwords are kept as scrypt hashes: scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>.

const N = 32768
const R = 8
const P = 1
const SALT_BYTES = 16
const KEY_BYTES = 64
const MAXMEM = 64 * 1024 * 1024

/** The scrypt call, injectable so a test can count how many times it ran. */
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

function parse(stored: string | null) {
  if (stored === null) return null
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const salt = Buffer.from(parts[4], 'base64url')
  const key = Buffer.from(parts[5], 'base64url')
  if (![n, r, p].every(Number.isInteger) || n < 2 || (n & (n - 1)) !== 0 || r < 1 || p < 1) return null
  if (salt.length === 0 || key.length === 0) return null
  return { N: n, r, p, salt, key }
}

/**
 * Whether password matches stored. scrypt runs exactly once whatever stored is (null and unreadable ones run against a
 * fixed dummy and give false).
 */
export async function verifyPassword(password: string, stored: string | null, derive: Scrypt = nodeScrypt): Promise<boolean> {
  const hash = parse(stored)
  const target = hash ?? DUMMY
  let key: Buffer
  try {
    key = await derive(password, target.salt, target.key.length, { N: target.N, r: target.r, p: target.p, maxmem: MAXMEM })
  } catch {
    return false
  }
  return key.length === target.key.length && timingSafeEqual(key, target.key) && hash !== null
}

// The login with Sparklingstadt ID (https://id.sparklingstadt.com), the OpenID Connect provider shared by the
// Sparklingstadt services: the parts of its Auth.js provider that decide something, kept apart so that the unit tests
// can run them. A Sparklingstadt ID is the account sid:<sub>, unless typle_sid_links links it to an account of another
// login (src/server/sidLinks.ts, read by jwtCallback in src/server/authOptions.ts).

/** The provider's id, which names /api/auth/signin/sid and /api/auth/callback/sid. */
export const SID_PROVIDER_ID = 'sid'

/** The form of a sub, as src/server/session.ts accepts sid:<sub>. */
const SUB = /^[a-z0-9]{1,64}$/

/** The claims of a Sparklingstadt ID token that the app reads. */
export type SidClaims = { sub: string, email?: string, email_verified?: unknown, name?: string | null }

/**
 * The account a Sparklingstadt ID login makes: sid:<sub>, named by the ID's name, or by its address before @ when the
 * name is blank. An ID whose address is not confirmed, or whose sub is not of its form, is refused (thrown), which
 * Auth.js answers by sending the browser back to the sign-in page with an error.
 */
export function sidProfile(profile: SidClaims): { id: string, name: string, image: '' } {
  if (profile.email_verified !== true) throw new Error('Sparklingstadt ID: the address is not confirmed')
  if (typeof profile.sub !== 'string' || !SUB.test(profile.sub)) throw new Error('Sparklingstadt ID: the sub is not of its form')
  const name = profile.name?.trim() || (profile.email ?? '').split('@')[0]
  return { id: `sid:${profile.sub}`, name, image: '' }
}

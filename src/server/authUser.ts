/**
 * The address Better Auth's user table needs for an account. typle-r keeps no real addresses (it sends no mail), so each
 * account gets a made-up one from its ID; `.invalid` is a name that can never be delivered to, and the IDs differ per
 * account, so Better Auth never sees two users with one address.
 */
export function accountEmail(accountId: string): string {
  return `${accountId}@users.invalid`
}

const ACCOUNT_EMAIL_SUFFIX = '@users.invalid'
const ACCOUNT_ID = /^(github:\d+|sid:[a-z0-9]{1,64})$/

/**
 * The account ID an address made by accountEmail stands for, or null for any other address (a real one, a missing
 * suffix, an ID of another form). Better Auth's OAuth sign-up passes the provider's email but never its id to the
 * user-create hook, so the hook gets the ID back from the address the providers return.
 */
export function accountIdFromEmail(email: string): string | null {
  if (!email.endsWith(ACCOUNT_EMAIL_SUFFIX)) return null
  const id = email.slice(0, -ACCOUNT_EMAIL_SUFFIX.length)
  return ACCOUNT_ID.test(id) ? id : null
}

/** The secret and the base URL Better Auth is built from, or null when either is missing or not usable. */
export function betterAuthSettings(env: Record<string, string | undefined>): { secret: string, baseURL: string } | null {
  const secret = env.BETTER_AUTH_SECRET?.trim()
  const baseURL = env.AUTH_URL?.trim()
  if (!secret || !baseURL) return null
  try {
    const { protocol } = new URL(baseURL)
    if (protocol !== 'http:' && protocol !== 'https:') return null
  } catch { return null }
  return { secret, baseURL }
}

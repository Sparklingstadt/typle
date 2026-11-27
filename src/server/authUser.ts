/**
 * The address Better Auth's user table needs for an account. typle-r keeps no real addresses (it sends no mail), so each
 * account gets a made-up one from its ID; `.invalid` is a name that can never be delivered to, and the IDs differ per
 * account, so Better Auth never sees two users with one address.
 */
export function accountEmail(accountId: string): string {
  return `${accountId}@users.invalid`
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

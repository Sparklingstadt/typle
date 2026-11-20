// A stand-in origin to resolve a path against: only whether the result stays on it matters.
const PLACEHOLDER_ORIGIN = 'https://return-path.invalid'

/**
 * The page to come back to after a login (a returnTo query, or Auth.js's callbackUrl): a path of this site, with its
 * query and hash, else home. Browsers drop tabs and line breaks from a URL and read "\" as "/", so a value with any
 * control character or backslash is refused before it is resolved, and what it resolves to must stay on the same
 * origin and not start with "//" (a path such as "/.//evil" resolves to one). An absolute URL is taken only when
 * siteOrigin is given and it is on that origin.
 */
export function returnPath(value: string | string[] | undefined, siteOrigin?: string): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f\\]/.test(value)) return '/home'
  const base = value.startsWith('/') ? PLACEHOLDER_ORIGIN : siteOrigin
  if (!base) return '/home'
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    return '/home'
  }
  if (url.origin !== new URL(base).origin) return '/home'
  const path = url.pathname + url.search + url.hash
  return path.startsWith('/') && !path.startsWith('//') ? path : '/home'
}

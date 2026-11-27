// A stand-in origin to resolve a path against: only whether the result stays on it matters.
const PLACEHOLDER_ORIGIN = 'https://return-path.invalid'

/**
 * The page to come back to after a login (a returnTo query): a path of this site, with its
 * query and hash, else home. Browsers drop tabs and line breaks from a URL and read "\" as "/", so a value with any
 * control character or backslash is refused before it is resolved, and what it resolves to must stay on the same
 * origin and not start with "//" (a path such as "/.//evil" resolves to one). Only a path is taken, never an absolute URL.
 */
export function returnPath(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f\\]/.test(value)) return '/home'
  if (!value.startsWith('/')) return '/home'
  let url: URL
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN)
  } catch {
    return '/home'
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return '/home'
  const path = url.pathname + url.search + url.hash
  return path.startsWith('/') && !path.startsWith('//') ? path : '/home'
}

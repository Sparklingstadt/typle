// The pieces of Go's net/url and strings that the login writes and reads its URLs and names with, so that a URL is the
// same text the Go backend sent, and a query is read as it read it. Go's strings are bytes; here text is decoded as
// UTF-8, so a byte that is not UTF-8 becomes U+FFFD where Go kept it.

/** Whether a byte is left as it is by url.QueryEscape: a letter, a digit, or one of - _ . ~ */
const unreserved = (byte: number) =>
  (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || byte === 0x2d || byte === 0x5f || byte === 0x2e || byte === 0x7e

/** text escaped as url.QueryEscape escapes it: a space is +, and every byte that is not unreserved is %XX. */
export function queryEscape(text: string): string {
  let escaped = ''
  for (const byte of Buffer.from(text, 'utf8')) {
    if (unreserved(byte)) escaped += String.fromCharCode(byte)
    else if (byte === 0x20) escaped += '+'
    else escaped += '%' + byte.toString(16).toUpperCase().padStart(2, '0')
  }
  return escaped
}

/** values as url.Values.Encode writes them: key=value, by key, each escaped with queryEscape. */
export function encodeValues(values: Record<string, string>): string {
  return Object.keys(values).sort().map(key => `${queryEscape(key)}=${queryEscape(values[key])}`).join('&')
}

/** The bytes of text with + as a space and %XX decoded, as url.QueryUnescape; null when a % is not followed by two hex digits. */
function queryUnescape(text: string): string | null {
  if (!/^(?:[^%]|%[0-9A-Fa-f]{2})*$/.test(text)) return null
  const bytes: number[] = []
  const raw = Buffer.from(text.replace(/\+/g, ' '), 'utf8')
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x25) {
      bytes.push(parseInt(String.fromCharCode(raw[i + 1], raw[i + 2]), 16))
      i += 2
    } else {
      bytes.push(raw[i])
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/**
 * The query rawQuery as url.ParseQuery reads it, with the values of each key in order. A pair with a semicolon, or one
 * whose key or value cannot be unescaped, is left out, as r.URL.Query() left it out.
 */
export function parseQuery(rawQuery: string): Map<string, string[]> {
  const values = new Map<string, string[]>()
  for (const pair of rawQuery.split('&')) {
    if (pair === '' || pair.includes(';')) continue
    const at = pair.indexOf('=')
    const key = queryUnescape(at < 0 ? pair : pair.slice(0, at))
    const value = queryUnescape(at < 0 ? '' : pair.slice(at + 1))
    if (key === null || value === null) continue
    values.set(key, [...(values.get(key) ?? []), value])
  }
  return values
}

/** The first value of key in the query of url, or '' (url.Values.Get). */
export function queryValue(url: URL, key: string): string {
  return parseQuery(url.search.slice(1)).get(key)?.[0] ?? ''
}

/** What unicode.IsSpace calls space. Unlike String.prototype.trim it has U+0085, and not U+FEFF. */
const SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const EDGE_SPACE = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'g')

/** text without the space at either end, as strings.TrimSpace. */
export function trimSpace(text: string): string {
  return text.replace(EDGE_SPACE, '')
}

/** Where a login goes back to without a returnTo of its own. */
export const DEFAULT_RETURN_TO = '/home'
/** Keeps the OAuth cookie, which holds returnTo, well under the 4096 bytes a browser accepts. */
const MAX_RETURN_TO = 1024

/** Whether every % in text is followed by two hex digits, as url.Parse requires of the path and the fragment. */
const escapesValid = (text: string) => /^(?:[^%]|%[0-9A-Fa-f]{2})*$/.test(text)

/**
 * Where to go back to after the login: a path of this site. Anything else, such as another site, a protocol-relative
 * URL (//host) or one a browser reads as such (/\host), one with a control character or a bad escape (which url.Parse
 * refused), or one over 1024 bytes, is /home. As the Go backend's safeReturnTo.
 */
export function safeReturnTo(value: string): string {
  const bytes = Buffer.byteLength(value, 'utf8')
  if (bytes < 1 || bytes > MAX_RETURN_TO || value[0] !== '/' || value[1] === '/' || value[1] === '\\') return DEFAULT_RETURN_TO
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_RETURN_TO
  const hash = value.indexOf('#')
  const beforeFragment = hash < 0 ? value : value.slice(0, hash)
  const fragment = hash < 0 ? '' : value.slice(hash + 1)
  const question = beforeFragment.indexOf('?')
  const path = question < 0 ? beforeFragment : beforeFragment.slice(0, question)
  return escapesValid(path) && escapesValid(fragment) ? value : DEFAULT_RETURN_TO
}

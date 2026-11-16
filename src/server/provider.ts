// How the login talks to GitHub and FFPF ID, as the Go backend's clients did (it was removed in v2.47.0): a request gives up
// after 10 seconds, a redirect is never followed (the token request carries the client secret, and must not be replayed
// to the target of a 3xx), and an answer is read up to 1 MiB.

const TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 1 << 20

/** A request to a login provider, which never follows a redirect. It throws when the provider does not answer. */
export function providerFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
}

/** The cause of a failed request in a few words, without its URL, so that nothing of the request is in an error message. */
export function causeOf(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
  if (cause instanceof Error) return (cause as NodeJS.ErrnoException).code ?? cause.name
  return 'unknown'
}

/** The first MAX_BODY_BYTES of the answer's body as text, as io.LimitReader gave them to Go's decoder. */
export async function readBody(response: Response): Promise<string> {
  if (!response.body) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  try {
    while (size < MAX_BODY_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES).toString('utf8')
}

/** The kind of a member that readFields reads: a string, an integer, any number, or the value as it is. */
type Kind = 'string' | 'integer' | 'number' | 'raw'
type Value<K extends Kind> = K extends 'string' ? string : K extends 'integer' | 'number' ? number : unknown

/**
 * The members of a JSON object as Go's json.Unmarshal read them into a struct: each name matched in any case, the later
 * one winning, a null leaving the member absent (undefined), and a member of another kind making the whole value
 * unreadable (null). null is also the answer when value is not an object; a JSON null reads as an object with nothing in it.
 */
export function readFields<F extends Record<string, Kind>>(value: unknown, fields: F): { [N in keyof F]?: Value<F[N]> } | null {
  const read: Record<string, unknown> = {}
  if (value === null) return read as { [N in keyof F]?: Value<F[N]> }
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const names = Object.keys(fields)
  for (const [key, member] of Object.entries(value)) {
    const name = names.find(n => n === key) ?? names.find(n => n.toLowerCase() === key.toLowerCase())
    if (name === undefined || member === null) continue
    const kind = fields[name]
    if ((kind === 'string' && typeof member !== 'string') || (kind === 'number' && typeof member !== 'number') ||
      (kind === 'integer' && !Number.isSafeInteger(member))) return null
    read[name] = member
  }
  return read as { [N in keyof F]?: Value<F[N]> }
}

/** The JSON value of text, or undefined when it is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

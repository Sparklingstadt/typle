// The JSON answers of the Route Handlers. They keep the form the Go backend answered with, which the iPad and Mac apps
// read: the same headers, and a body that ends with a newline as Go's json.Encoder wrote it. The four security headers
// come from next.config.mjs, which applies them to every path, the Route Handlers included.

/** A JSON answer. Many are the account's own and an error may depend on the cookie, so no cache keeps any. */
export function reply(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value) + '\n', {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
    },
  })
}

/** A refused request. The key is one of the app's `errors` messages, which the screen shows in the reader's language. */
export function refuse(status: number, key: string): Response {
  return reply(status, { error: key })
}

/** The answer to a method the path does not serve. */
export function methodNotAllowed(allow: readonly string[]): Response {
  const response = refuse(405, 'methodNotAllowed')
  response.headers.set('Allow', allow.join(', '))
  return response
}

/** The answer to a HEAD request: the same status and headers as the GET answer, without its body. */
export function withoutBody(response: Response): Response {
  return new Response(null, { status: response.status, headers: response.headers })
}

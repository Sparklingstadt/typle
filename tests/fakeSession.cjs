// A made-up session reader for the tests of the API (the reader signedIn takes, src/server/account.ts), so that they need
// neither Better Auth's settings nor its tables: the Cookie header `test-user=<account ID>` signs that account in.

/** The cookie that signs the account in. */
const cookieFor = id => `test-user=${encodeURIComponent(id)}`

/** The session of the request's Cookie header, or null without one. */
async function readTestSession(headers) {
  const match = /(?:^|;\s*)test-user=([^;]*)/.exec(headers.get('cookie') ?? '')
  return match ? { user: { id: decodeURIComponent(match[1]), name: 'N', image: '' } } : null
}

module.exports = { cookieFor, readTestSession }

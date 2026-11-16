import { encodeValues } from './goUrl'
import { causeOf, parseJson, providerFetch, readBody, readFields } from './provider'
import type { GitHubSettings } from './settings'

// The GitHub OAuth App the browser's login goes through, as the Go backend's auth.OAuth and auth.GitHub did it: the
// authorize URL, the trade of the code that comes back for the user's token (with PKCE, the client secret sent only to the
// token endpoint), and GET /user, read once with that token to know who signed in. The token is not kept.

/** A GitHub account, as GET /user describes it. */
export type GitHubUser = { id: number, login: string, name: string, avatarUrl: string }

/** Why GitHub's account could not be had: GitHub refused the token, or did not answer in a way that says anything. */
export class GitHubError extends Error {
  constructor(readonly kind: 'invalidToken' | 'unavailable', message: string) {
    super(message)
    this.name = 'GitHubError'
  }
}

/** Where to send the browser to sign in. No scope is asked for: the app only needs to know who the user is. */
export function githubAuthorizeUrl(github: GitHubSettings, state: string, challenge: string, redirectUri: string): string {
  return `${github.authorizeUrl}?${encodeValues({
    client_id: github.clientId, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256',
  })}`
}

/**
 * Trades the code GitHub sent back for the user's token. The verifier is the one whose challenge the authorize URL had,
 * and redirectUri the same. An error never has the client secret, the code or the verifier in its message.
 */
export async function exchangeGitHubCode(github: GitHubSettings, code: string, verifier: string, redirectUri: string): Promise<string> {
  let response: Response
  try {
    response = await providerFetch(github.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: encodeValues({ client_id: github.clientId, client_secret: github.clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
  } catch (error) {
    throw new Error(`GitHub token request failed: ${causeOf(error)}`)
  }
  if (response.status < 200 || response.status > 299) {
    await response.body?.cancel()
    throw new Error(`GitHub token request answered ${response.status}`)
  }
  // GitHub answers 200 even when it refuses the code, with the reason in error.
  const body = readFields(parseJson(await readBody(response)), { access_token: 'string', error: 'string' })
  if (!body) throw new Error('GitHub token answer is not JSON')
  if (body.error) throw new Error(`GitHub refused the code: ${body.error}`)
  if (!body.access_token) throw new Error('GitHub token answer has no access token')
  return body.access_token
}

/** The account the token belongs to: GitHubError invalidToken when GitHub refuses it, unavailable for anything else. */
export async function githubUser(github: GitHubSettings, token: string): Promise<GitHubUser> {
  let response: Response
  try {
    response = await providerFetch(`${github.apiUrl}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    })
  } catch (error) {
    throw new GitHubError('unavailable', `GitHub could not check the token: ${causeOf(error)}`)
  }
  if (response.status === 401) {
    await response.body?.cancel()
    throw new GitHubError('invalidToken', 'GitHub does not accept the token')
  }
  if (response.status !== 200) {
    // 403 and 429 are rate limits; 5xx is GitHub's own trouble. None says the token is bad.
    await response.body?.cancel()
    throw new GitHubError('unavailable', `GitHub could not check the token: GitHub answered ${response.status}`)
  }
  // name and avatar_url may be null, which reads as empty.
  const body = readFields(parseJson(await readBody(response)), { id: 'integer', login: 'string', name: 'string', avatar_url: 'string' })
  if (!body || !body.id || body.id <= 0) throw new GitHubError('unavailable', 'GitHub could not check the token: GitHub\'s answer has no user id')
  return { id: body.id, login: body.login ?? '', name: body.name ?? '', avatarUrl: body.avatar_url ?? '' }
}

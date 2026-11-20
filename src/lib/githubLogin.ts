// Whether the GitHub login is offered, read where the app is served: by src/auth.ts, which adds the provider, and by
// the sign-in page, which shows its button only then.

/** Whether the GitHub login can be offered: Auth.js reads its client ID and secret from these. */
export const githubConfigured = (env: Record<string, string | undefined> = process.env) =>
  !!env.AUTH_GITHUB_ID && !!env.AUTH_GITHUB_SECRET

// Whether the GitHub login is offered, read where the app is served: by src/server/betterAuth.ts, which adds the provider, and by
// the sign-in page, which shows its button only then.

/** Whether the GitHub login can be offered: Better Auth reads its client ID and secret from these. */
export const githubConfigured = (env: Record<string, string | undefined> = process.env) =>
  !!env.AUTH_GITHUB_ID && !!env.AUTH_GITHUB_SECRET

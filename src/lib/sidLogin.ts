// Whether the Sparklingstadt ID login is offered, read where the app is served: by src/server/betterAuth.ts, which adds the
// provider, and by the sign-in page, which shows its button only then.

/** Whether the Sparklingstadt ID login can be offered: Better Auth needs its issuer, client ID and secret. */
export const sidConfigured = (env: Record<string, string | undefined> = process.env) =>
  !!env.AUTH_SID_ISSUER && !!env.AUTH_SID_ID && !!env.AUTH_SID_SECRET

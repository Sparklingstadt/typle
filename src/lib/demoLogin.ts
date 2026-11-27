// Whether the shared demo account's login is offered, read where the app is served: by src/server/settings.ts, which
// answers the login only then, and by the sign-in page, which shows its button only then.

/** Whether the demo login is on: DEMO_LOGIN is exactly 1, in production as anywhere else. */
export const demoConfigured = (env: Record<string, string | undefined> = process.env) => env.DEMO_LOGIN === '1'

// The one-time links mailed to an address (/verify-email?token=…, /reset-password?token=…).

/**
 * Takes ?token= out of the address bar once the page has read it, so that the token is not kept in the history, a
 * bookmark or a shared screen. Next.js folds replaceState into its router, so the page is not loaded again.
 */
export function dropLinkToken(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('token')) return
  url.searchParams.delete('token')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

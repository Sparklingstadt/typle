/** The page to come back to after a login (a returnTo query): a path of this site, else home. */
export function returnPath(value: string | string[] | undefined): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/home'
}

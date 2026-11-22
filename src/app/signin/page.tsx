import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageMain } from '@/components/ui/page-layout'
import { githubConfigured } from '@/lib/githubLogin'
import { sidConfigured } from '@/lib/sidLogin'
import { returnPath } from '@/lib/returnPath'
import SignInForm from './signin-form'

/** The origin of AUTH_URL, the one Auth.js builds its callbackUrl on; undefined when it is not set or not a URL. */
function authOrigin(): string | undefined {
  try {
    return new URL(process.env.AUTH_URL ?? '').origin
  } catch {
    return undefined
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account')
  // A page of no content of its own: kept out of the search results.
  return { title: t('signIn'), robots: { index: false, follow: true } }
}

export default async function SignIn({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const t = await getTranslations('account')
  const params = await searchParams
  // Auth.js sends a browser here with its callbackUrl (an absolute URL of AUTH_URL's origin, or a path) instead.
  const returnTo = params.returnTo !== undefined ? returnPath(params.returnTo) : returnPath(params.callbackUrl, authOrigin())
  return <PageMain width="narrow">
    <header className="mb-6 space-y-1">
      <h1 className="text-2xl font-bold">{t('signIn')}</h1>
    </header>
    {/* Auth.js sends a login that failed on its side here with ?error=<type> (pages.error in src/auth.ts). */}
    <SignInForm returnTo={returnTo} github={githubConfigured()} sid={sidConfigured()} authError={params.error !== undefined} />
  </PageMain>
}

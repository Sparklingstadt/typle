import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageMain } from '@/components/ui/page-layout'
import { githubConfigured } from '@/lib/githubLogin'
import { sidConfigured } from '@/lib/sidLogin'
import { returnPath } from '@/lib/returnPath'
import SignInForm from './signin-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account')
  // A page of no content of its own: kept out of the search results.
  return { title: t('signIn'), robots: { index: false, follow: true } }
}

export default async function SignIn({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const t = await getTranslations('account')
  const params = await searchParams
  const returnTo = returnPath(params.returnTo)
  const github = githubConfigured()
  const sid = sidConfigured()
  return <PageMain width="narrow">
    <header className="mb-6 space-y-1">
      <h1 className="text-2xl font-bold">{t('signIn')}</h1>
      {/* It names both logins, so it is shown only when both are offered. */}
      {sid && github && <p className="text-sm text-muted-foreground">
        {t.rich('signInIntro', { b: chunks => <strong className="font-semibold text-foreground">{chunks}</strong> })}
      </p>}
    </header>
    {/* Better Auth sends a login that failed on its side here with ?error=<code> (errorCallbackURL, onAPIError.errorURL): every code is the one message. */}
    <SignInForm returnTo={returnTo} github={github} sid={sid} authError={params.error !== undefined} />
  </PageMain>
}

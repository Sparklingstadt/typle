import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageMain } from '@/components/ui/page-layout'
import { githubConfigured } from '@/lib/githubLogin'
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
  return <PageMain width="narrow">
    <header className="mb-6 space-y-1">
      <h1 className="text-2xl font-bold">{t('signIn')}</h1>
    </header>
    {/* Auth.js sends a login that failed on its side here with ?error=<type> (pages.error in src/auth.ts). */}
    <SignInForm returnTo={returnTo} github={githubConfigured()} authError={params.error !== undefined} />
  </PageMain>
}

import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageMain } from '@/components/ui/page-layout'
import SignInForm from './signin-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account')
  // A page of no content of its own: kept out of the search results.
  return { title: t('signIn'), robots: { index: false, follow: true } }
}

/** The page to come back to after the login: a path of this site, else home. */
function returnPath(value: string | string[] | undefined): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/home'
}

export default async function SignIn({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const t = await getTranslations('account')
  const returnTo = returnPath((await searchParams).returnTo)
  return <PageMain width="narrow">
    <header className="mb-6 space-y-1">
      <h1 className="text-2xl font-bold">{t('signIn')}</h1>
    </header>
    <SignInForm returnTo={returnTo} />
  </PageMain>
}

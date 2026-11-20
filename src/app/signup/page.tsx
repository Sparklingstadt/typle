import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageHeader, PageMain } from '@/components/ui/page-layout'
import { returnPath } from '@/lib/returnPath'
import SignUpForm from './signup-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signUp')
  // The account pages say nothing of their own: kept out of the search results (and the sitemap).
  return { title: t('title'), robots: { index: false, follow: true } }
}

export default async function SignUp({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const t = await getTranslations('auth.signUp')
  const returnTo = returnPath((await searchParams).returnTo)
  return <PageMain width="narrow">
    <PageHeader title={t('title')} description={t('description')} />
    <SignUpForm returnTo={returnTo} />
  </PageMain>
}

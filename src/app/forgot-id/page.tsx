import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageHeader, PageMain } from '@/components/ui/page-layout'
import { returnPath } from '@/lib/returnPath'
import ForgotIdForm from './forgot-id-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.forgotId')
  return { title: t('title'), robots: { index: false, follow: true } }
}

export default async function ForgotId({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const t = await getTranslations('auth.forgotId')
  const returnTo = returnPath((await searchParams).returnTo)
  return <PageMain width="narrow">
    <PageHeader title={t('title')} description={t('description')} />
    <ForgotIdForm returnTo={returnTo} />
  </PageMain>
}

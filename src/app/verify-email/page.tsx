import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageHeader, PageMain } from '@/components/ui/page-layout'
import VerifyEmail from './verify-email'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.verifyEmail')
  return { title: t('title'), robots: { index: false, follow: true } }
}

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const t = await getTranslations('auth.verifyEmail')
  const { token } = await searchParams
  return <PageMain width="narrow">
    <PageHeader title={t('title')} description={t('description')} />
    <VerifyEmail token={typeof token === 'string' ? token : ''} />
  </PageMain>
}

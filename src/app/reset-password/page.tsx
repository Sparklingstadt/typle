import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageHeader, PageMain } from '@/components/ui/page-layout'
import ResetPasswordForm from './reset-password-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.resetPassword')
  return { title: t('title'), robots: { index: false, follow: true } }
}

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const t = await getTranslations('auth.resetPassword')
  const { token } = await searchParams
  return <PageMain width="narrow">
    <PageHeader title={t('title')} description={t('description')} />
    <ResetPasswordForm token={typeof token === 'string' ? token : ''} />
  </PageMain>
}

import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageHeader, PageMain } from '@/components/ui/page-layout'
import ForgotPasswordForm from './forgot-password-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.forgotPassword')
  return { title: t('title'), robots: { index: false, follow: true } }
}

export default async function ForgotPassword() {
  const t = await getTranslations('auth.forgotPassword')
  return <PageMain width="narrow">
    <PageHeader title={t('title')} description={t('description')} />
    <ForgotPasswordForm />
  </PageMain>
}

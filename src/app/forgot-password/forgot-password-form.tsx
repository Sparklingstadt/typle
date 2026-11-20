"use client"
import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { FormField, FormMessage, useApiErrorText } from '@/components/AccountForm'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

// Asks for the link that sets a new password. The answer is the same whether the ID exists or not, so the page says
// the same thing either way.
export default function ForgotPasswordForm() {
  const t = useTranslations('auth')
  const errorText = useApiErrorText()
  const [loginId, setLoginId] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ kind: 'done' | 'error', text: string } | null>(null)
  return <form className="max-w-sm space-y-4" onSubmit={async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setOutcome(null)
    try {
      await api('/api/account/forgot-password', { method: 'POST', body: { loginId } })
      setOutcome({ kind: 'done', text: t('forgotPassword.sent') })
    } catch (reason) {
      setOutcome({ kind: 'error', text: errorText(reason, t('failed')) })
    }
    setBusy(false)
  }}>
    <FormField label={t('fields.loginId')} name="loginId" autoComplete="username" value={loginId} onChange={setLoginId} disabled={busy} />
    <Button type="submit" size="lg" disabled={busy || !loginId.trim()}>{t('send')}</Button>
    {outcome && <FormMessage kind={outcome.kind}>{outcome.text}</FormMessage>}
    <p className="text-sm"><Link className="underline underline-offset-4" href="/forgot-id">{t('signIn.forgotId')}</Link></p>
    <p className="text-sm"><Link className="underline underline-offset-4" href="/signin">{t('backToSignIn')}</Link></p>
  </form>
}

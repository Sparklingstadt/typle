"use client"
import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { FormField, FormMessage, useApiErrorText } from '@/components/AccountForm'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

// Asks for the IDs of an address by mail. The answer is the same whether an account has the address or not, so the
// page says the same thing either way.
export default function ForgotIdForm({ returnTo }: { returnTo: string }) {
  const t = useTranslations('auth')
  const errorText = useApiErrorText()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ kind: 'done' | 'error', text: string } | null>(null)
  return <form className="max-w-sm space-y-4" onSubmit={async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setOutcome(null)
    try {
      await api('/api/account/forgot-id', { method: 'POST', body: { email } })
      setOutcome({ kind: 'done', text: t('forgotId.sent') })
    } catch (reason) {
      setOutcome({ kind: 'error', text: errorText(reason, t('failed')) })
    }
    setBusy(false)
  }}>
    <FormField label={t('fields.email')} name="email" type="email" autoComplete="email" value={email} onChange={setEmail} disabled={busy} />
    <Button type="submit" size="lg" disabled={busy || !email.trim()}>{t('send')}</Button>
    {outcome && <FormMessage kind={outcome.kind}>{outcome.text}</FormMessage>}
    <p className="text-sm"><Link className="underline underline-offset-4" href={`/signin?returnTo=${encodeURIComponent(returnTo)}`}>{t('backToSignIn')}</Link></p>
  </form>
}

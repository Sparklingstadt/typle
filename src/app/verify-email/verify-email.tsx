"use client"
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { FormMessage, useApiErrorText } from '@/components/AccountForm'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

// Confirms the address of the mailed link once the page is open in a browser: the request is sent by the page, not by
// opening the link, so a mail scanner that only fetches the link does not use it up.
export default function VerifyEmail({ token }: { token: string }) {
  const t = useTranslations('auth.verifyEmail')
  const errors = useTranslations('errors')
  const errorText = useApiErrorText()
  const [state, setState] = useState<{ kind: 'busy' } | { kind: 'done' } | { kind: 'failed', text: string }>(
    token ? { kind: 'busy' } : { kind: 'failed', text: errors('invalidToken') })
  // The link can be used once: an effect run twice (React's development checks) sends it once.
  const sent = useRef(false)
  useEffect(() => {
    if (!token || sent.current) return
    sent.current = true
    api('/api/account/verify', { method: 'POST', body: { token } }).then(
      () => setState({ kind: 'done' }),
      reason => setState({ kind: 'failed', text: errorText(reason, t('failed')) }))
  }, [token, errorText, t])

  return <div className="max-w-sm space-y-4">
    {state.kind === 'busy' && <p role="status" className="text-sm text-muted-foreground">{t('verifying')}</p>}
    {state.kind === 'done' && <FormMessage kind="done">{t('done')}</FormMessage>}
    {state.kind === 'failed' && <FormMessage kind="error">{state.text}</FormMessage>}
    {state.kind !== 'busy' && <Button asChild variant="outline"><Link href="/home">{t('home')}</Link></Button>}
  </div>
}

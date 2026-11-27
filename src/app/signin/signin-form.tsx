"use client"
import { useState } from 'react'
import { LogIn } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { signInWithGitHub, signInWithSid } from '@/lib/session'

// The sign-in: Sparklingstadt ID and GitHub, the only logins.
export default function SignInForm({ returnTo, github, sid, authError }: {
  returnTo: string, github: boolean, sid: boolean, authError: boolean,
}) {
  const t = useTranslations('account')
  const errors = useTranslations('errors')
  const [busy, setBusy] = useState(false)
  // A login that could not start, or that Better Auth sent back here, is one message.
  const [failed, setFailed] = useState(authError)

  /** Goes to the provider; on success the page is gone, so the buttons stay busy. */
  const start = (signIn: (returnTo: string) => Promise<void>) => async () => {
    setBusy(true)
    setFailed(false)
    try { await signIn(returnTo) } catch { setFailed(true); setBusy(false) }
  }

  return <div className="max-w-sm space-y-4">
    {/* Sparklingstadt ID, the login shared by the Sparklingstadt services, comes first. */}
    {sid && <Button size="lg" className="w-full" disabled={busy} onClick={start(signInWithSid)}>
      <LogIn aria-hidden="true" />{t('signInWithSid')}
    </Button>}
    {github && <Button size="lg" className="w-full" variant={sid ? 'outline' : 'default'} disabled={busy} onClick={start(signInWithGitHub)}>
      <LogIn aria-hidden="true" />{t('signInWithGitHub')}
    </Button>}
    {!sid && !github && <p className="text-sm text-muted-foreground">{errors('authUnavailable')}</p>}
    {failed && <p role="alert" className="text-sm text-destructive">{t('signInFailed')}</p>}
  </div>
}

"use client"
import { useState } from 'react'
import { LogIn, UserRound } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { signInDemo, signInWithGitHub, signInWithSid } from '@/lib/session'

// The sign-in: Sparklingstadt ID and GitHub, and the shared demo account for visitors who have neither.
export default function SignInForm({ returnTo, github, sid, demo, authError }: {
  returnTo: string, github: boolean, sid: boolean, demo: boolean, authError: boolean,
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
    {/* A Sparklingstadt ID and a GitHub login are separate accounts (accountLinking is off) unless the owner links them (npm run sid:link). */}
    {(sid || github) && <p className="text-xs text-muted-foreground">{t('signInNote')}</p>}
    {/* The demo account is shared, and put back every day (src/server/demoReset.ts): the note says so before it is used. */}
    {demo && <div className={(sid || github) ? 'space-y-2 border-t pt-4' : 'space-y-2'}>
      <Button size="lg" className="w-full" variant="outline" disabled={busy} onClick={start(signInDemo)}>
        <UserRound aria-hidden="true" />{t('signInDemo')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('demoNote')}</p>
    </div>}
    {!sid && !github && !demo && <p className="text-sm text-muted-foreground">{errors('authUnavailable')}</p>}
    {failed && <p role="alert" className="text-sm text-destructive">{t('signInFailed')}</p>}
  </div>
}

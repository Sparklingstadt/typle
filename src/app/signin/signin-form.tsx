"use client"
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LogIn } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { FormField, FormMessage } from '@/components/AccountForm'
import { Button } from '@/components/ui/button'
import { signInWithGitHub, signInWithPassword, useSession } from '@/lib/session'

/** The query that keeps returnTo on the account pages linked from here, unless it is the default. */
const keep = (returnTo: string) => returnTo === '/home' ? '' : `?returnTo=${encodeURIComponent(returnTo)}`

export default function SignInForm({ returnTo, github, authError }: { returnTo: string, github: boolean, authError: boolean }) {
  const t = useTranslations('account')
  const auth = useTranslations('auth')
  const router = useRouter()
  const { update } = useSession()
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  // A failure of the GitHub login, or of any login that Auth.js sent back here, is one message; a refused ID and
  // password is another, which does not tell whether the ID, the password or a hold on the login is the cause.
  const [failure, setFailure] = useState<'failed' | 'refused' | null>(authError ? 'failed' : null)

  return <div className="max-w-sm space-y-6">
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault()
      if (busy) return
      setBusy(true)
      setFailure(null)
      try {
        if (await signInWithPassword(loginId, password, update) === 'refused') {
          setFailure('refused')
          setBusy(false)
          return
        }
        router.push(returnTo)
        router.refresh()
      } catch {
        setFailure('failed')
        setBusy(false)
      }
    }}>
      <FormField label={auth('fields.loginId')} name="loginId" autoComplete="username" value={loginId} onChange={setLoginId} />
      <FormField label={auth('fields.password')} name="password" type="password" autoComplete="current-password"
        value={password} onChange={setPassword} />
      <Button type="submit" size="lg" disabled={busy || !loginId || !password}>{auth('signIn.submit')}</Button>
    </form>
    {failure && <FormMessage kind="error">{failure === 'refused' ? auth('signIn.refused') : t('signInFailed')}</FormMessage>}
    <ul className="space-y-1 text-sm">
      <li><Link className="underline underline-offset-4" href={`/signup${keep(returnTo)}`}>{auth('signIn.signUp')}</Link></li>
      <li><Link className="underline underline-offset-4" href={`/forgot-password${keep(returnTo)}`}>{auth('signIn.forgotPassword')}</Link></li>
      <li><Link className="underline underline-offset-4" href={`/forgot-id${keep(returnTo)}`}>{auth('signIn.forgotId')}</Link></li>
    </ul>
    {github && <div className="space-y-3 border-t pt-6">
      <p className="text-sm text-muted-foreground">{auth('signIn.or')}</p>
      <Button size="lg" variant="outline" disabled={busy} onClick={async () => {
        setBusy(true)
        setFailure(null)
        // On success the page goes to GitHub, so the button stays busy until it is gone.
        try { await signInWithGitHub(returnTo) } catch { setFailure('failed'); setBusy(false) }
      }}><LogIn aria-hidden="true" />{t('signInWithGitHub')}</Button>
    </div>}
  </div>
}

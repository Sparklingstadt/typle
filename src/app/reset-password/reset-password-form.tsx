"use client"
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { FormField, FormMessage, useApiErrorText } from '@/components/AccountForm'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { passwordProblem } from '@/lib/accountRules'
import { signInWithPassword, useSession } from '@/lib/session'

// Sets a new password with the mailed link, then signs in with it (the server has signed out every device).
export default function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('auth')
  const errors = useTranslations('errors')
  const errorText = useApiErrorText()
  const router = useRouter()
  const { update } = useSession()
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState('')
  const [failure, setFailure] = useState<{ text: string, signIn?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  return <form className="max-w-sm space-y-4" noValidate onSubmit={async event => {
    event.preventDefault()
    if (busy) return
    setFailure(null)
    // The ID is not known here, so a password that is the ID is left to the server.
    const issue = passwordProblem(password, '')
    setProblem(issue ? errors(issue) : '')
    if (issue) return
    setBusy(true)
    let loginId: string
    try {
      ({ loginId } = await api<{ loginId: string }>('/api/account/reset-password', { method: 'POST', body: { token, password } }))
    } catch (reason) {
      const text = errorText(reason, t('failed'))
      if (reason instanceof ApiError && (reason.key === 'passwordLength' || reason.key === 'passwordSameAsId')) setProblem(text)
      else setFailure({ text })
      setBusy(false)
      return
    }
    try {
      if (await signInWithPassword(loginId, password, update) !== 'signedIn') throw new Error('refused')
      router.push('/home')
      router.refresh()
    } catch {
      setFailure({ text: t('resetPassword.signInFailed'), signIn: true })
      setBusy(false)
    }
  }}>
    <FormField label={t('fields.newPassword')} name="password" type="password" autoComplete="new-password" value={password}
      onChange={setPassword} error={problem} hint={t('fields.passwordHint')} disabled={busy} />
    <Button type="submit" size="lg" disabled={busy}>{t('resetPassword.submit')}</Button>
    {failure && <FormMessage kind="error">{failure.text}</FormMessage>}
    {failure && <p className="text-sm">
      <Link className="underline underline-offset-4" href={failure.signIn ? '/signin' : '/forgot-password'}>
        {failure.signIn ? t('backToSignIn') : t('resetPassword.again')}
      </Link>
    </p>}
  </form>
}

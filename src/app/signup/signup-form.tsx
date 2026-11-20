"use client"
import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { FormField, FormMessage, useApiErrorText } from '@/components/AccountForm'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { emailProblem, loginIdProblem, normalizeEmail, normalizeLoginId, passwordProblem } from '@/lib/accountRules'
import { signInWithPassword, useSession } from '@/lib/session'

type Field = 'loginId' | 'email' | 'password'
type Problems = Partial<Record<Field, string>>

/** The field an error key of the sign-up is about; undefined for one about the whole form. */
const FIELD_OF: Record<string, Field> = {
  loginIdFormat: 'loginId', loginIdTaken: 'loginId', passwordLength: 'password', passwordSameAsId: 'password', emailFormat: 'email',
}

// Signing up: the rules are checked here first, each field showing its own problem, and the server decides (a taken
// ID comes from it). A created account is signed in at once, and the page then says whether the mail that confirms
// the address was sent, with the way back to the page the user came from.
export default function SignUpForm({ returnTo }: { returnTo: string }) {
  const t = useTranslations('auth')
  const errors = useTranslations('errors')
  const errorText = useApiErrorText()
  const { update } = useSession()
  const [values, setValues] = useState<Record<Field, string>>({ loginId: '', email: '', password: '' })
  const [problems, setProblems] = useState<Problems>({})
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ mailSent: boolean, signedIn: boolean, email: string } | null>(null)
  const set = (field: Field) => (value: string) => setValues(current => ({ ...current, [field]: value }))

  if (done) {
    return <div className="max-w-sm space-y-4">
      {done.signedIn
        ? <FormMessage kind="done">{t('signUp.done')}</FormMessage>
        : <FormMessage kind="error">{t('signUp.signInFailed')}</FormMessage>}
      <p className="text-sm">{done.mailSent ? t('signUp.mailSent', { email: done.email }) : t('signUp.mailNotSent')}</p>
      <Button asChild size="lg"><Link href={done.signedIn ? returnTo : '/signin'}>{t('signUp.continue')}</Link></Button>
    </div>
  }

  return <form className="max-w-sm space-y-4" noValidate onSubmit={async event => {
    event.preventDefault()
    if (busy) return
    setFailure('')
    const loginId = normalizeLoginId(values.loginId)
    const email = normalizeEmail(values.email)
    const found: Problems = {}
    const idProblem = loginIdProblem(loginId)
    const passwordIssue = passwordProblem(values.password, loginId)
    const emailIssue = emailProblem(email)
    if (idProblem) found.loginId = errors(idProblem)
    if (passwordIssue) found.password = errors(passwordIssue)
    if (emailIssue) found.email = errors(emailIssue)
    setProblems(found)
    if (Object.keys(found).length) return
    setBusy(true)
    let mailSent: boolean
    try {
      ({ mailSent } = await api<{ loginId: string, mailSent: boolean }>('/api/account/signup',
        { method: 'POST', body: { loginId, email, password: values.password } }))
    } catch (reason) {
      const field = reason instanceof ApiError && reason.key ? FIELD_OF[reason.key] : undefined
      const text = errorText(reason, t('signUp.failed'))
      if (field) setProblems({ [field]: text })
      else setFailure(text)
      setBusy(false)
      return
    }
    let signedIn = false
    try {
      signedIn = await signInWithPassword(loginId, values.password, update) === 'signedIn'
    } catch {
      // The account exists either way: the page says so and sends the user to the sign-in page.
    }
    setDone({ mailSent, signedIn, email })
  }}>
    <FormField label={t('fields.loginId')} name="loginId" autoComplete="username" value={values.loginId}
      onChange={set('loginId')} error={problems.loginId} hint={t('fields.loginIdHint')} disabled={busy} />
    <FormField label={t('fields.email')} name="email" type="email" autoComplete="email" value={values.email}
      onChange={set('email')} error={problems.email} hint={t('fields.emailHint')} disabled={busy} />
    <FormField label={t('fields.password')} name="password" type="password" autoComplete="new-password"
      value={values.password} onChange={set('password')} error={problems.password} hint={t('fields.passwordHint')} disabled={busy} />
    <Button type="submit" size="lg" disabled={busy}>{busy ? t('signUp.submitting') : t('signUp.submit')}</Button>
    {failure && <FormMessage kind="error">{failure}</FormMessage>}
    <p className="text-sm">
      <Link className="underline underline-offset-4" href={`/signin?returnTo=${encodeURIComponent(returnTo)}`}>{t('signUp.haveAccount')}</Link>
    </p>
  </form>
}

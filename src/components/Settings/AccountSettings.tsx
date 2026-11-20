"use client"
import { useCallback, useEffect, useId, useState } from 'react'
import { UserRound } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { FormField, FormMessage, useApiErrorText } from '@/components/AccountForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconTile } from '@/components/ui/icon-tile'
import { api, ApiError } from '@/lib/api'
import { passwordProblem } from '@/lib/accountRules'
import { signInWithPassword, useSession } from '@/lib/session'

type Me = { loginId: string, email: string, emailVerified: boolean }
type Outcome = { kind: 'done' | 'error', text: string } | null

// The account section of the settings, for an account that signs in with an ID and a password only: its ID, its
// address and whether it is confirmed (GET /api/account/me), mailing the link that confirms it again, and changing
// the password, after which this browser signs in again with the new one (the server signs out the other devices).
export default function AccountSettings() {
  const t = useTranslations('auth.settings')
  const fields = useTranslations('auth.fields')
  const errors = useTranslations('errors')
  const errorText = useApiErrorText()
  const { data: session, update } = useSession()
  const accountId = session?.user.id.startsWith('password:') ? session.user.id : null
  const id = useId()
  const [me, setMe] = useState<Me | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [mailBusy, setMailBusy] = useState(false)
  const [mailOutcome, setMailOutcome] = useState<Outcome>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [problem, setProblem] = useState('')
  const [changeBusy, setChangeBusy] = useState(false)
  const [changeOutcome, setChangeOutcome] = useState<Outcome>(null)

  const load = useCallback(() => api<Me>('/api/account/me').then(
    answer => { setMe(answer); setLoadFailed(false) },
    () => setLoadFailed(true)), [])
  useEffect(() => {
    if (!accountId) return
    let live = true
    api<Me>('/api/account/me').then(
      answer => { if (live) { setMe(answer); setLoadFailed(false) } },
      () => { if (live) setLoadFailed(true) })
    return () => { live = false }
  }, [accountId])
  if (!accountId) return null

  return <section aria-labelledby={`${id}-heading`} className="rounded-xl border bg-card p-4 sm:p-5">
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 sm:gap-x-4">
      <IconTile icon={UserRound} />
      <div className="min-w-0 space-y-1">
        <h2 id={`${id}-heading`} className="font-bold">{t('heading')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
    </div>
    <div className="mt-4 space-y-6 sm:pl-14">
      {loadFailed && <FormMessage kind="error">{t('loadFailed')}</FormMessage>}
      {me && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{fields('loginId')}</dt>
        <dd className="break-all">{me.loginId}</dd>
        <dt className="text-muted-foreground">{fields('email')}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="break-all">{me.email}</span>
          <Badge variant={me.emailVerified ? 'secondary' : 'outline'}>{me.emailVerified ? t('verified') : t('unverified')}</Badge>
        </dd>
      </dl>}
      {me && !me.emailVerified && <div className="space-y-2">
        <Button variant="outline" disabled={mailBusy} onClick={async () => {
          setMailBusy(true)
          setMailOutcome(null)
          try {
            const answer = await api<{ alreadyVerified?: boolean, mailSent?: boolean }>('/api/account/resend-verification', { method: 'POST', body: {} })
            if (answer.alreadyVerified) {
              setMailOutcome({ kind: 'done', text: t('alreadyVerified') })
              await load()
            } else setMailOutcome(answer.mailSent ? { kind: 'done', text: t('resent') } : { kind: 'error', text: t('mailNotSent') })
          } catch (reason) {
            setMailOutcome({ kind: 'error', text: errorText(reason, t('mailNotSent')) })
          }
          setMailBusy(false)
        }}>{t('resend')}</Button>
        {mailOutcome && <FormMessage kind={mailOutcome.kind}>{mailOutcome.text}</FormMessage>}
      </div>}
      {me && <form className="max-w-sm space-y-4" noValidate onSubmit={async event => {
        event.preventDefault()
        if (changeBusy) return
        setChangeOutcome(null)
        const issue = passwordProblem(next, me.loginId)
        setProblem(issue ? errors(issue) : '')
        if (issue || !current) return
        setChangeBusy(true)
        try {
          await api('/api/account/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } })
        } catch (reason) {
          const text = errorText(reason, t('failed'))
          if (reason instanceof ApiError && (reason.key === 'passwordLength' || reason.key === 'passwordSameAsId')) setProblem(text)
          else setChangeOutcome({ kind: 'error', text })
          setChangeBusy(false)
          return
        }
        try {
          if (await signInWithPassword(me.loginId, next, update) !== 'signedIn') throw new Error('refused')
          setCurrent('')
          setNext('')
          setChangeOutcome({ kind: 'done', text: t('changed') })
        } catch {
          setChangeOutcome({ kind: 'error', text: t('signInAgain') })
        }
        setChangeBusy(false)
      }}>
        <div className="space-y-1">
          <h3 className="text-sm font-bold">{t('changePassword')}</h3>
          <p className="text-sm text-muted-foreground">{t('changePasswordDescription')}</p>
        </div>
        <FormField label={fields('currentPassword')} name="currentPassword" type="password" autoComplete="current-password"
          value={current} onChange={setCurrent} disabled={changeBusy} />
        <FormField label={fields('newPassword')} name="newPassword" type="password" autoComplete="new-password"
          value={next} onChange={setNext} error={problem} hint={fields('passwordHint')} disabled={changeBusy} />
        <Button type="submit" disabled={changeBusy || !current || !next}>{t('change')}</Button>
        {changeOutcome && <FormMessage kind={changeOutcome.kind}>{changeOutcome.text}</FormMessage>}
      </form>}
    </div>
  </section>
}

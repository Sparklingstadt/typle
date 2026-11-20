"use client"
import { useState } from 'react'
import { LogIn } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { signInWithGitHub } from '@/lib/session'

export default function SignInForm({ returnTo }: { returnTo: string }) {
  const t = useTranslations('account')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className="space-y-3">
    <Button size="lg" disabled={busy} onClick={async () => {
      setBusy(true)
      setFailed(false)
      // On success the page goes to GitHub, so the button stays busy until it is gone.
      try { await signInWithGitHub(returnTo) } catch { setFailed(true); setBusy(false) }
    }}><LogIn aria-hidden="true" />{t('signInWithGitHub')}</Button>
    {failed && <p role="alert" className="text-sm text-destructive">{t('signInFailed')}</p>}
  </div>
}

"use client"
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWordLists } from '@/hooks/useWordLists'
import { isWelcomeDismissed, shouldWelcome } from '@/lib/welcome'

/** Sends a first-time visitor (nothing saved yet, tour not dismissed) to /welcome. True while that applies, so the caller keeps showing its loading state. */
export function useWelcomeRedirect(): boolean {
  const router = useRouter()
  const { ready, accountId, error, revision } = useWordLists()
  const redirecting = ready && !!accountId && !error && shouldWelcome({ revision, dismissed: isWelcomeDismissed(accountId) })
  useEffect(() => {
    if (redirecting) router.replace('/welcome')
  }, [redirecting, router])
  return redirecting
}

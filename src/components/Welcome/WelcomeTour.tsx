"use client"
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useWordLists } from '@/hooks/useWordLists'
import { ErrorAlert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageMain } from '@/components/ui/page-layout'
import InterestSettings from '@/components/Settings/InterestSettings'
import PackStep from '@/components/Welcome/PackStep'
import StartStep from '@/components/Welcome/StartStep'
import { normalizeInterests } from '@/lib/interests'
import { applyCatalogChoices } from '@/lib/packs/catalog'
import { randomId } from '@/lib/randomId'
import { practicePath } from '@/lib/routes'
import { dismissWelcome, hasChildInterest, welcomePacks } from '@/lib/welcome'

const STEPS = ['interests', 'packs', 'start'] as const
type Step = typeof STEPS[number]

// The first-visit tour: pick interests, follow an entry pack for each, start practice. Nothing is saved until 「フォローする」,
// which saves the follow first and the interests second, so leaving halfway never narrows the interests without packs.
export default function WelcomeTour() {
  const { ready, revision, accountId, error, saving, packs, lists, updateLibrary, updateInterests } = useWordLists()
  const router = useRouter()
  const t = useTranslations('home.tour')
  const common = useTranslations('common')
  const [step, setStep] = useState<Step>('interests')
  const [chosen, setChosen] = useState<string[]>([])
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [followedCatalogId, setFollowedCatalogId] = useState<string | null>(null)
  // The packs are followed but saving the interests failed: step 2 offers to save them again.
  const [interestsFailed, setInterestsFailed] = useState(false)
  // Whether the tour is for this visitor, decided once on the first load: the follow raises the revision later, and
  // that must not send them away mid-tour. Someone who has saved before goes home, so the tour never overwrites them.
  const [admitted, setAdmitted] = useState<boolean | null>(null)
  if (admitted === null && ready) setAdmitted(revision === 0)
  useEffect(() => {
    if (admitted === false) router.replace('/home')
  }, [admitted, router])

  // Move focus to the new step's heading so keyboard and screen reader users land on it; not on the first render.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    document.getElementById(`welcome-${step}`)?.focus()
  }, [step])

  const entries = welcomePacks(chosen)

  function later() {
    if (accountId) dismissWelcome(accountId)
    router.replace('/home')
  }

  function check(catalogId: string, value: boolean) {
    setChecked(current => {
      const next = new Set(current)
      if (value) next.add(catalogId)
      else next.delete(catalogId)
      return next
    })
  }

  async function saveInterests() {
    const saved = await updateInterests(() => normalizeInterests(chosen))
    setInterestsFailed(!saved)
    if (saved) setStep('start')
  }

  async function follow() {
    const choices = entries.filter(entry => checked.has(entry.catalogId)).map(entry => ({ catalogId: entry.catalogId, follow: true }))
    if (!choices.length) return
    // Another tab or device saved meanwhile: the tour must not overwrite it.
    if (revision !== 0) { router.replace('/home'); return }
    const saved = await updateLibrary(library =>
      applyCatalogChoices(library, choices, entry => ({ pack: randomId(), lists: entry.lists.map(() => randomId()) })))
    if (!saved) return
    setFollowedCatalogId(choices[0].catalogId)
    await saveInterests()
  }

  const followed = packs.find(pack => pack.origin?.catalogId === followedCatalogId)
  const firstList = followed && lists.find(list => list.packId === followed.id)

  return <PageMain width="narrow">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        {admitted && <p className="text-sm text-muted-foreground">{t('step', { current: STEPS.indexOf(step) + 1, total: STEPS.length })}</p>}
        <h1 className="text-2xl font-bold">{t('title')}</h1>
      </div>
      {admitted && <Button variant="ghost" onClick={later}>{t('later')}</Button>}
    </header>
    {error && <ErrorAlert className="mb-6">{error}</ErrorAlert>}
    {!admitted ? <div role="status" className="space-y-3"><p className="sr-only">{common('loading')}</p><Skeleton className="h-10 w-72 max-w-full" /><Skeleton className="h-24 w-full" /></div>
      : step === 'interests' ? <section aria-labelledby="welcome-interests" className="space-y-5">
        <div className="space-y-1">
          <h2 id="welcome-interests" tabIndex={-1} className="text-lg font-bold">{t('interests.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('interests.text')}</p>
        </div>
        <InterestSettings interests={chosen} saving={false} updateInterests={async change => { setChosen(change); return true }} />
        <div className="flex justify-end">
          <Button disabled={!hasChildInterest(chosen)} onClick={() => {
            setChecked(new Set(entries.map(entry => entry.catalogId)))
            setStep('packs')
          }}>{t('next')}</Button>
        </div>
      </section>
      : step === 'packs' ? <PackStep entries={entries} checked={checked} check={check} saving={saving}
        interestsFailed={interestsFailed} follow={() => void follow()} retryInterests={() => void saveInterests()} />
      : <StartStep pack={followed?.name ?? ''} list={firstList}
        start={() => router.push(firstList ? practicePath(firstList.id) : '/play')} />}
  </PageMain>
}

"use client"
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LazyMotion, MotionConfig, domMax } from 'motion/react'
import { useWordLists } from '@/hooks/useWordLists'
import { ErrorAlert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageMain } from '@/components/ui/page-layout'
import Kbd from '@/components/Practice/Kbd'
import KeyToggle from '@/components/Welcome/KeyToggle'
import PackStep from '@/components/Welcome/PackStep'
import PracticePanel from '@/components/Welcome/PracticePanel'
import StartStep from '@/components/Welcome/StartStep'
import StepDots from '@/components/Welcome/StepDots'
import TypedHeading from '@/components/Welcome/TypedHeading'
import { INTEREST_OPTIONS, normalizeInterests } from '@/lib/interests'
import { applyCatalogChoices, loadOfficialPacks, packSummaries } from '@/lib/packs/officialCatalog'
import { randomId } from '@/lib/randomId'
import { practicePath } from '@/lib/routes'
import { NATIVE_LANGUAGE_NAMES, carryChecks, dismissWelcome, hasChildInterest, toggleWelcomeInterest, welcomeKey, welcomePacks, type WelcomeKey, type WelcomeStep } from '@/lib/welcome'

const STEPS: readonly WelcomeStep[] = ['interests', 'packs', 'start']

// What has the focus, for the tour's keyboard: Enter on a link or on a button other than a key is left to it, and keys
// pressed in the navigation, a menu or a dialog are not the tour's. With nothing focused the target is the body.
function targetKind(target: EventTarget | null): WelcomeKey['targetKind'] {
  if (!(target instanceof Element) || target === document.body || target === document.documentElement) return 'none'
  if (!target.closest('[data-welcome-tour]') || target.closest('[role="menu"], [role="dialog"]')) return 'outside'
  if (target.closest('a[href]')) return 'link'
  if (target instanceof HTMLInputElement) return target.type === 'checkbox' ? 'none' : 'otherButton'
  return target.closest('button, select, textarea, [role="button"]') ? 'otherButton' : 'none'
}

// The first-visit tour: pick interests, follow an entry pack for each, start practice. Nothing is saved until 「フォローする」,
// which saves the follow first and the interests second, so leaving halfway never narrows the interests without packs.
export default function WelcomeTour() {
  const { ready, revision, accountId, error, saving, packs, lists, updateLibrary, updateInterests } = useWordLists()
  const router = useRouter()
  const t = useTranslations('home.tour')
  const names = useTranslations('interests')
  const common = useTranslations('common')
  const [step, setStep] = useState<WelcomeStep>('interests')
  const [chosen, setChosen] = useState<string[]>([])
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  // The packs the checks were set for, so that coming back from the interests keeps the checks of the packs that stay.
  const [checkedFor, setCheckedFor] = useState<string[]>([])
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

  const entries = welcomePacks(chosen, packSummaries())
  const entryIds = entries.map(entry => entry.catalogId)
  const checkedCount = entries.filter(entry => checked.has(entry.catalogId)).length
  const followed = packs.find(pack => pack.origin?.catalogId === followedCatalogId)
  const firstList = followed && lists.find(list => list.packId === followed.id)

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

  function toPacks() {
    if (!hasChildInterest(chosen)) return
    setChecked(carryChecks(checked, checkedFor, entryIds))
    setCheckedFor(entryIds)
    setStep('packs')
  }

  async function saveInterests() {
    const saved = await updateInterests(() => normalizeInterests(chosen))
    setInterestsFailed(!saved)
    if (saved) setStep('start')
  }

  async function follow() {
    const choices = entries.filter(entry => checked.has(entry.catalogId)).map(entry => ({ catalogId: entry.catalogId, follow: true }))
    if (!choices.length || saving) return
    // Another tab or device saved meanwhile: the tour must not overwrite it.
    if (revision !== 0) { router.replace('/home'); return }
    const saved = await updateLibrary(library =>
      applyCatalogChoices(library, choices, entry => ({ pack: randomId(), lists: entry.lists.map(() => randomId()) })),
      undefined, () => loadOfficialPacks(choices.map(choice => choice.catalogId)))
    if (!saved) return
    setFollowedCatalogId(choices[0].catalogId)
    await saveInterests()
  }

  function start() {
    router.push(firstList ? practicePath(firstList.id) : '/play')
  }

  // Added again on each render, so it always sees the current step and checks.
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!admitted) return
      const state = saving ? 'saving' : interestsFailed ? 'retry' : 'idle'
      const action = welcomeKey({ key: event.key, isComposing: event.isComposing, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
        altKey: event.altKey, repeat: event.repeat, defaultPrevented: event.defaultPrevented, targetKind: targetKind(event.target) },
      step, entries.length, state)
      if (!action) return
      event.preventDefault()
      if (action.kind === 'later') later()
      else if (action.kind === 'back') setStep('interests')
      else if (action.kind === 'toggle') check(entries[action.index].catalogId, !checked.has(entries[action.index].catalogId))
      else if (step === 'interests') toPacks()
      else if (step === 'packs') void (interestsFailed ? saveInterests() : follow())
      else start()
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  })

  const panel = <PracticePanel entries={entries} mode={step === 'packs' ? 'choose' : 'preview'} checked={checked} onCheck={check}
    disabled={saving || interestsFailed} title={t('panel.title')} empty={t('panel.empty')}
    stats={(listCount, words) => t('packs.stats', { lists: listCount, words })} select={name => t('packs.select', { name })} />

  return <LazyMotion features={domMax} strict><MotionConfig reducedMotion="user">
    <PageMain width="wide" data-welcome-tour="">
      <h1 className="sr-only">{t('title')}</h1>
      <header className="mb-8 flex items-center justify-between gap-3">
        {admitted ? <StepDots current={STEPS.indexOf(step) + 1} total={STEPS.length} label={t('step', { current: STEPS.indexOf(step) + 1, total: STEPS.length })} /> : <span />}
        {admitted && step !== 'start' && <Button variant="ghost" size="sm" onClick={later}>{t('later')}<span aria-hidden="true"><Kbd className="ml-1">Esc</Kbd></span></Button>}
      </header>
      {error && <ErrorAlert className="mb-6">{error}</ErrorAlert>}
      {!admitted ? <div role="status" className="space-y-3"><p className="sr-only">{common('loading')}</p><Skeleton className="h-10 w-72 max-w-full" /><Skeleton className="h-24 w-full" /></div>
        : step === 'start' ? <StartStep pack={followed?.name ?? ''} list={firstList} start={start} />
        : <div className="grid items-start gap-6 sm:grid-cols-[1.15fr_1fr] sm:gap-10">
          {step === 'interests' ? <section aria-label={t('interests.title')} className="flex flex-col gap-5">
            <div className="space-y-2">
              <TypedHeading id="welcome-interests" text={t('interests.heading')} />
              <p className="text-sm text-muted-foreground">{t('interests.text')}</p>
            </div>
            {INTEREST_OPTIONS.map(option => {
              const parent = option.id as 'language' | 'programming'
              return <div key={option.id} role="group" aria-labelledby={`welcome-parent-${option.id}`} className="space-y-2">
                <h3 id={`welcome-parent-${option.id}`} className="text-xs font-medium text-muted-foreground">{names(`parents.${parent}`)}</h3>
                <div className="flex flex-wrap gap-2">
                  {option.children.map(item => {
                    const name = names(`children.${option.id as 'language'}.${item.id.split('/')[1] as 'zh'}`)
                    const native = NATIVE_LANGUAGE_NAMES[item.id]
                    return <KeyToggle key={item.id} checked={chosen.includes(item.id)} accessibleName={name}
                      label={native ?? name} sub={native && native !== name ? name : undefined} mono={!native}
                      onChange={() => setChosen(current => toggleWelcomeInterest(current, item.id))} />
                  })}
                </div>
              </div>
            })}
            <div className="sticky bottom-0 -mx-1 bg-background/95 px-1 py-3 sm:static sm:bg-transparent sm:py-0">
              <Button disabled={!hasChildInterest(chosen)} onClick={toPacks}>{t('next')}<span aria-hidden="true">↵</span></Button>
            </div>
          </section>
          : <PackStep count={entries.length} checkedCount={checkedCount} saving={saving} interestsFailed={interestsFailed}
            follow={() => void follow()} retryInterests={() => void saveInterests()} back={() => setStep('interests')} />}
          {panel}
        </div>}
    </PageMain>
  </MotionConfig></LazyMotion>
}

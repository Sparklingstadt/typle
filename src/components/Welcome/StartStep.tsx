"use client"
import { useTranslations } from 'next-intl'
import { m } from 'motion/react'
import { Button } from '@/components/ui/button'
import type { SavedWordList } from '@/lib/wordLists'
import TypedHeading from './TypedHeading'
import TypingDemo from './TypingDemo'

// The last step: the first word of the first followed pack, typing itself as in practice, and a button into it.
export default function StartStep({ pack, list, start }: { pack: string, list: SavedWordList | undefined, start: () => void }) {
  const t = useTranslations('home.tour')
  const word = list?.words[0]
  return <m.section aria-label={t('start.title')} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    className="mx-auto flex max-w-2xl flex-col items-center gap-5 py-4 text-center">
    {list && <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{t('packs.first', { list: list.name })}</p>}
    {word && <div className="w-full rounded-2xl border bg-card py-6"><TypingDemo word={word} /></div>}
    <TypedHeading id="welcome-start" text={t('start.heading')} />
    <p className="text-sm text-muted-foreground">{t('start.text', { pack })}</p>
    <Button size="lg" onClick={start}>{t('start.button')}<span aria-hidden="true">↵</span></Button>
  </m.section>
}

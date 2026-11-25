"use client"
import { useTranslations } from 'next-intl'
import { Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { SavedWordList } from '@/lib/wordLists'

const SAMPLE_WORDS = 3

// The last step of the tour: the first list of the first followed pack, and a button into its practice.
export default function StartStep({ pack, list, start }: { pack: string, list: SavedWordList | undefined, start: () => void }) {
  const t = useTranslations('home.tour')
  return <section aria-labelledby="welcome-start" className="space-y-5">
    <div className="space-y-1">
      <h2 id="welcome-start" tabIndex={-1} className="text-lg font-bold">{t('start.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('start.text', { pack })}</p>
    </div>
    {list && <Card className="gap-3 px-5 py-5">
      <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{t('packs.first', { list: list.name })}</p>
      <ul className="space-y-1 font-mono text-[15px]">
        {list.words.slice(0, SAMPLE_WORDS).map((word, index) => <li key={index}>{word.display}</li>)}
      </ul>
    </Card>}
    <div className="flex justify-end">
      <Button onClick={start}><Keyboard aria-hidden="true" />{t('start.button')}</Button>
    </div>
  </section>
}

"use client"
import { AnimatePresence, m } from 'motion/react'
import type { OfficialPack } from '@/lib/packs/catalog'
import { cn } from '@/lib/utils'
import KeyToggle from './KeyToggle'

const SAMPLE_WORDS = 3
const MAX_SHORTCUTS = 9

type Props = {
  entries: OfficialPack[]
  mode: 'preview' | 'choose'
  checked: ReadonlySet<string>
  onCheck: (catalogId: string, value: boolean) => void
  disabled: boolean
  title: string
  empty: string
  stats: (lists: number, words: number) => string
  select: (name: string) => string
}

// 「あなたの最初の練習」: the packs the chosen interests bring. On the first step it previews their words; on the second
// the same cards (joined by layoutId) gain a check. On phones the preview is one line per pack.
export default function PracticePanel({ entries, mode, checked, onCheck, disabled, title, empty, stats, select }: Props) {
  const choosing = mode === 'choose'
  return <m.aside layout aria-label={title} className="flex flex-col gap-2.5 rounded-2xl bg-primary/8 p-4 sm:p-5">
    <m.p layout="position" className="text-xs font-medium text-muted-foreground">{title}</m.p>
    {!entries.length && <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>}
    <ul className="flex flex-col gap-2.5">
      <AnimatePresence initial={false}>
        {entries.map((entry, index) => {
          const on = checked.has(entry.catalogId)
          const words = entry.lists.reduce((total, list) => total + list.words.length, 0)
          const sample = entry.lists[0]?.words.slice(0, SAMPLE_WORDS).map(word => word.display).join(' · ')
          return <m.li key={entry.catalogId} layoutId={entry.catalogId} data-catalog-id={entry.catalogId}
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: choosing && !on ? 0.45 : 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className={cn('rounded-xl border bg-card px-4', choosing ? 'flex items-center justify-between gap-3 py-3' : 'py-2 sm:py-3')}>
            <div className="min-w-0">
              <p className="text-sm font-bold [overflow-wrap:anywhere]">{entry.pack.name}</p>
              {choosing
                ? <p className="text-xs text-muted-foreground">{stats(entry.lists.length, words)}</p>
                : sample && <p className="mt-1 hidden font-mono text-[13px] [overflow-wrap:anywhere] sm:block">{sample}</p>}
            </div>
            {choosing && <KeyToggle checked={on} disabled={disabled} onChange={value => onCheck(entry.catalogId, value)}
              accessibleName={select(entry.pack.name)} label={on ? "✓" : "\u00a0"} shortcut={index < MAX_SHORTCUTS ? String(index + 1) : undefined} />}
          </m.li>
        })}
      </AnimatePresence>
    </ul>
  </m.aside>
}

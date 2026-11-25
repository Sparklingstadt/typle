"use client"
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ListPlus, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { OfficialPack } from '@/lib/packs/catalog'

const SAMPLE_WORDS = 3

type Props = {
  entries: OfficialPack[]
  checked: ReadonlySet<string>
  check: (catalogId: string, value: boolean) => void
  saving: boolean
  // The packs are followed but the interests were not saved: the step offers to save them again instead.
  interestsFailed: boolean
  follow: () => void
  retryInterests: () => void
}

// The second step of the tour: one entry pack per chosen interest, checked, shown as on /play's starter packs.
export default function PackStep({ entries, checked, check, saving, interestsFailed, follow, retryInterests }: Props) {
  const t = useTranslations('home.tour')
  const count = entries.filter(entry => checked.has(entry.catalogId)).length
  return <section aria-labelledby="welcome-packs" className="space-y-5">
    <div className="space-y-1">
      <h2 id="welcome-packs" className="text-lg font-bold">{t('packs.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('packs.text')}</p>
    </div>
    <ul className="grid gap-4 sm:grid-cols-2">
      {entries.map(entry => {
        const first = entry.lists[0]
        const words = entry.lists.reduce((total, list) => total + list.words.length, 0)
        return <li key={entry.catalogId} data-catalog-id={entry.catalogId}>
          <Card className="h-full gap-3 px-5 py-5">
            <div className="flex items-start gap-3">
              <input type="checkbox" aria-label={t('packs.select', { name: entry.pack.name })} disabled={saving || interestsFailed}
                checked={checked.has(entry.catalogId)} onChange={event => check(entry.catalogId, event.target.checked)}
                className="mt-1.5 size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed" />
              <div className="min-w-0 space-y-1">
                <h3 className="text-lg font-bold [overflow-wrap:anywhere]">{entry.pack.name}</h3>
                <p className="text-[13px] text-muted-foreground">{t('packs.stats', { lists: entry.lists.length, words })}</p>
              </div>
            </div>
            <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{t('packs.first', { list: first?.name ?? '' })}</p>
            <ul className="space-y-1 font-mono text-[15px]">
              {first?.words.slice(0, SAMPLE_WORDS).map((word, index) => <li key={index}>{word.display}</li>)}
            </ul>
          </Card>
        </li>
      })}
    </ul>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">{t.rich('packs.more', {
        catalog: chunks => <Link href="/packs/catalog" className="underline">{chunks}</Link>,
      })}</p>
      {interestsFailed
        ? <Button disabled={saving} onClick={retryInterests}><RotateCw aria-hidden="true" />{t('packs.retryInterests')}</Button>
        : <Button disabled={saving || !count} onClick={follow}>
          <ListPlus aria-hidden="true" />{saving ? t('packs.following') : t('packs.follow')}
        </Button>}
    </div>
  </section>
}

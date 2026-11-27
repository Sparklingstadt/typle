"use client"
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowLeft, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Kbd from '@/components/Practice/Kbd'
import TypedHeading from './TypedHeading'

const MAX_SHORTCUTS = 9

type Props = {
  count: number
  checkedCount: number
  saving: boolean
  // The packs are followed but the interests were not saved: the step offers to save them again instead.
  interestsFailed: boolean
  follow: () => void
  retryInterests: () => void
  back: () => void
}

// The left side of the second step; the packs themselves are in the practice panel beside it.
export default function PackStep({ count, checkedCount, saving, interestsFailed, follow, retryInterests, back }: Props) {
  const t = useTranslations('home.tour')
  return <section aria-label={t('packs.title')} className="flex flex-col gap-4">
    <TypedHeading id="welcome-packs" text={t('packs.heading', { count })} />
    <p className="text-sm">{t.rich('packs.more', {
      catalog: chunks => <Link href="/packs/catalog" className="underline">{chunks}</Link>,
    })}</p>
    {count > 0 && !interestsFailed && <p className="hidden text-sm leading-7 text-muted-foreground sm:block">{t.rich('packs.keys', {
      last: Math.min(count, MAX_SHORTCUTS),
      key: chunks => <Kbd>{chunks}</Kbd>,
    })}</p>}
    <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-3 sm:static sm:bg-transparent sm:py-0">
      {interestsFailed
        ? <Button disabled={saving} onClick={retryInterests}><RotateCw aria-hidden="true" />{t('packs.retryInterests')}</Button>
        : <>
          <Button disabled={saving || !checkedCount} onClick={follow}>
            {saving ? t('packs.following') : t('packs.follow')}<span aria-hidden="true">↵</span>
          </Button>
          {!saving && <Button variant="ghost" onClick={back}><ArrowLeft aria-hidden="true" />{t('packs.back')}</Button>}
        </>}
    </div>
  </section>
}

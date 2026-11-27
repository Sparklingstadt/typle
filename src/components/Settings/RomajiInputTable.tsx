import { useTranslations } from 'next-intl'
import { ROMAJI_EXAMPLES, SMALL_TSU, SYLLABIC_N, kanaCandidates } from '@/lib/romaji'

// The spellings come from the same table practice uses, so the page always shows what is accepted.

function Key({ children }: { children: string }) {
  return <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</kbd>
}

export default function RomajiInputTable() {
  const t = useTranslations('input.romaji')
  const cell = 'px-4 py-2'
  return <section aria-labelledby="romaji-heading" className="rounded-xl border bg-card p-4 sm:p-5">
    <div className="space-y-1">
      <h2 id="romaji-heading" className="font-bold">{t('heading')}</h2>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
    </div>
    <div className="mt-4 overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className={`${cell} font-medium`}>{t('kana')}</th>
            <th scope="col" className={`${cell} font-medium`}>{t('keys')}</th>
          </tr>
        </thead>
        <tbody>
          {ROMAJI_EXAMPLES.map(kana => {
            const chars = Array.from(kana)
            const spellings = (kanaCandidates(chars, 0) ?? []).filter(candidate => candidate.kana === kana).map(candidate => candidate.romaji)
            return <tr key={kana} className="border-b">
              <td className={`${cell} text-base`} lang="ja">{kana}</td>
              <td className={`${cell} flex flex-wrap gap-1.5`}>{spellings.map(romaji => <Key key={romaji}>{romaji}</Key>)}</td>
            </tr>
          })}
          <tr className="border-b">
            <td className={`${cell} text-base`} lang="ja">{SYLLABIC_N.kana}</td>
            <td className={cell}><span className="flex flex-wrap gap-1.5">{SYLLABIC_N.romaji.map(romaji => <Key key={romaji}>{romaji}</Key>)}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t('syllabicN')}</span></td>
          </tr>
          <tr>
            <td className={`${cell} text-base`} lang="ja">{SMALL_TSU.kana}</td>
            <td className={cell}><span className="flex flex-wrap gap-1.5">{SMALL_TSU.romaji.map(romaji => <Key key={romaji}>{romaji}</Key>)}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t('smallTsu')}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
}

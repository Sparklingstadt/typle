import { withoutFollowedWords } from '../lib/followedPacks'
import { followOfficialPack, officialPacks } from '../lib/packs/catalog'
import type { PracticeRecord } from '../lib/records'
import type { SavedWordList } from '../lib/wordLists'
import { convertLibrary, type Library } from '../lib/wordPacks'
import type { WorkspaceChange } from '../lib/workspaceDocument'

// The sample the shared demo account starts from and is put back to every day (src/server/demoReset.ts): two lists of
// its own with a week of practice, two followed official packs and interests already chosen (so the welcome tour is
// done). Every value is fixed but the dates, which are placed in this week and the one before in Japan (times).

/** The official packs the demo follows: one of programming, one of languages. */
export const DEMO_FOLLOWED = ['pack-0b27f311-38aa-40aa-9c29-ea17e374e1fe', 'pack-english-basic-words']

const DEVICE = { id: 'demo-device', name: 'MacBook', layout: 'US' }
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const word = (input: string, annotation: string) => ({ input, display: input, annotation })

/** A run of the list at the time at, that went wrong once on each of missed (none for a perfect run). */
const run = (id: string, at: number, time: number, accuracy: number, wordCount: number, missed: string[] = []): PracticeRecord => ({
  id, time, accuracy, mistakes: missed.length, wordCount, date: new Date(at).toISOString(), device: DEVICE,
  ...(missed.length ? { missed: missed.map(word => ({ word, count: 1 })) } : {}),
})

/** Japan's offset from UTC: the cron resets at 4:00 there, and the dashboard's week starts on Monday at 0:00. */
const JAPAN = 9 * 60 * MINUTE

/** Monday 0:00 in Japan of the week of now. */
function weekStart(now: Date): number {
  const japan = new Date(now.getTime() + JAPAN)
  const midnight = Date.UTC(japan.getUTCFullYear(), japan.getUTCMonth(), japan.getUTCDate())
  return midnight - ((japan.getUTCDay() + 6) % 7) * DAY - JAPAN
}

/**
 * When the runs fall: eight between Monday 0:00 in Japan and now, spread evenly (so a reset on any day fills this
 * week's summary), and three in the week before (so its comparison with last week has something to compare).
 */
function times(now: Date) {
  const start = weekStart(now)
  const thisWeek = (slot: number) => start + (now.getTime() - start) * slot / 9
  const lastWeek = (daysBefore: number) => start - daysBefore * DAY + 21 * 60 * MINUTE
  return { start, thisWeek, lastWeek }
}

function ownLists(now: Date): SavedWordList[] {
  const { start, thisWeek, lastWeek } = times(now)
  const created = new Date(start - 7 * DAY).toISOString()
  return [
    {
      id: 'demo-git', name: 'よく使う Git コマンド', group: 'Git', category: 'プログラミング', tags: ['Git'], createdAt: created, // i18n-ignore: sample data
      words: [
        word('git status', '作業ツリーの状態を見る'), word('git add -p', '変更を少しずつステージする'), // i18n-ignore
        word('git commit --amend', '直前のコミットを直す'), word('git switch -c', '新しいブランチを作って移る'), // i18n-ignore
        word('git log --oneline', '履歴を1行ずつ見る'), word('git rebase -i', 'コミットを並べ替える・まとめる'), // i18n-ignore
        word('git stash', '変更を一時的に退避する'), // i18n-ignore
      ],
      records: [
        run('demo-git-1', lastWeek(3), 42.8, 91.4, 7, ['git rebase -i', 'git commit --amend']), run('demo-git-2', lastWeek(1), 38.1, 94.2, 7, ['git rebase -i']),
        run('demo-git-3', thisWeek(1), 33.5, 97.1, 7, ['git add -p']), run('demo-git-4', thisWeek(3), 31.9, 97.6, 7, ['git rebase -i']),
        run('demo-git-5', thisWeek(5), 29.4, 100, 7), run('demo-git-6', thisWeek(7), 27.6, 100, 7),
      ],
    },
    {
      id: 'demo-words', name: 'ITの英単語', group: '英単語', category: '語学', tags: ['英語'], createdAt: created, // i18n-ignore
      words: [
        word('deploy', '配置する・公開する'), word('deprecate', '非推奨にする'), word('idempotent', '何度実行しても同じ結果になる'), // i18n-ignore
        word('latency', '遅延'), word('throughput', '処理量'), word('fallback', '代わりの手段'), // i18n-ignore
      ],
      records: [
        run('demo-words-1', lastWeek(2), 35.2, 88.9, 6, ['idempotent', 'throughput']), run('demo-words-2', thisWeek(2), 30.7, 93.8, 6, ['idempotent']),
        run('demo-words-3', thisWeek(4), 28.3, 95.5, 6, ['deprecate']), run('demo-words-4', thisWeek(6), 26.1, 97.0, 6, ['idempotent']),
        run('demo-words-5', thisWeek(8), 24.8, 100, 6),
      ],
    },
  ]
}

/** The demo account's workspace at now, following those of catalogIds that the catalog still has. */
export function demoWorkspace(now: Date, catalogIds: string[] = DEMO_FOLLOWED): Required<WorkspaceChange> {
  const known = new Set(officialPacks().map(entry => entry.catalogId))
  let library: Library = convertLibrary(ownLists(now))
  for (const catalogId of catalogIds.filter(id => known.has(id))) {
    const entry = officialPacks().find(item => item.catalogId === catalogId)!
    library = followOfficialPack(library, catalogId, {
      pack: `demo-${catalogId}`, lists: entry.lists.map((_, n) => `demo-${catalogId}-${n + 1}`),
    }, now)
  }
  const saved = withoutFollowedWords(library)
  return { lists: saved.lists, packs: saved.packs, devices: [DEVICE], interests: ['programming/linux', 'language/en'] }
}

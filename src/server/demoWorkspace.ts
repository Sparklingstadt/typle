import { withoutFollowedWords } from '../lib/followedPacks'
import { followOfficialPack, officialPacks } from '../lib/packs/catalog'
import type { PracticeRecord } from '../lib/records'
import type { SavedWordList } from '../lib/wordLists'
import { convertLibrary, type Library } from '../lib/wordPacks'
import type { WorkspaceChange } from '../lib/workspaceDocument'

// The sample the shared demo account starts from and is put back to every day (src/server/demoReset.ts): two lists of
// its own with a week of practice, two followed official packs and interests already chosen (so the welcome tour is
// done). Every value is fixed but the dates, which are counted back from now so that this week's summary has them.

/** The official packs the demo follows: one of programming, one of languages. */
export const DEMO_FOLLOWED = ['pack-0b27f311-38aa-40aa-9c29-ea17e374e1fe', 'pack-english-basic-words']

const DEVICE = { id: 'demo-device', name: 'MacBook', layout: 'US' }
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const word = (input: string, annotation: string) => ({ input, display: input, annotation })

/** A run of the list, ago before now, that went wrong once on each of missed (none for a perfect run). */
const run = (id: string, now: Date, ago: number, time: number, accuracy: number, wordCount: number, missed: string[] = []): PracticeRecord => ({
  id, time, accuracy, mistakes: missed.length, wordCount, date: new Date(now.getTime() - ago).toISOString(), device: DEVICE,
  ...(missed.length ? { missed: missed.map(word => ({ word, count: 1 })) } : {}),
})

function ownLists(now: Date): SavedWordList[] {
  const created = new Date(now.getTime() - 6 * DAY).toISOString()
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
        run('demo-git-1', now, 6 * DAY - 3 * 60 * MINUTE, 42.8, 91.4, 7, ['git rebase -i', 'git commit --amend']), run('demo-git-2', now, 5 * DAY, 38.1, 94.2, 7, ['git rebase -i']),
        run('demo-git-3', now, 3 * DAY + 40 * MINUTE, 33.5, 97.1, 7, ['git add -p']), run('demo-git-4', now, 2 * DAY, 31.9, 97.6, 7, ['git rebase -i']),
        run('demo-git-5', now, DAY + 10 * MINUTE, 29.4, 100, 7), run('demo-git-6', now, 2 * 60 * MINUTE, 27.6, 100, 7),
      ],
    },
    {
      id: 'demo-words', name: 'ITの英単語', group: '英単語', category: '語学', tags: ['英語'], createdAt: created, // i18n-ignore
      words: [
        word('deploy', '配置する・公開する'), word('deprecate', '非推奨にする'), word('idempotent', '何度実行しても同じ結果になる'), // i18n-ignore
        word('latency', '遅延'), word('throughput', '処理量'), word('fallback', '代わりの手段'), // i18n-ignore
      ],
      records: [
        run('demo-words-1', now, 5 * DAY + 2 * 60 * MINUTE, 35.2, 88.9, 6, ['idempotent', 'throughput']), run('demo-words-2', now, 4 * DAY, 30.7, 93.8, 6, ['idempotent']),
        run('demo-words-3', now, 3 * DAY, 28.3, 95.5, 6, ['deprecate']), run('demo-words-4', now, DAY, 26.1, 97.0, 6, ['idempotent']),
        run('demo-words-5', now, 30 * MINUTE, 24.8, 100, 6),
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

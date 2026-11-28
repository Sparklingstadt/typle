import type { PracticeRecord } from './records'
import type { SavedWordList } from './wordLists'

// Two lists with a week of practice: the demo account's own lists (src/server/demoWorkspace.ts) and the preview of the
// home screen before the first record (src/app/home/page.tsx). Every value is fixed but the dates, which are placed in
// the week that starts at weekStart and the one before.

export const SAMPLE_DEVICE = { id: 'demo-device', name: 'MacBook', layout: 'US' }
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const word = (input: string, annotation: string) => ({ input, display: input, annotation })

/** A run of the list at the time at, that went wrong once on each of missed (none for a perfect run). */
const run = (id: string, at: number, time: number, accuracy: number, wordCount: number, missed: string[] = []): PracticeRecord => ({
  id, time, accuracy, mistakes: missed.length, wordCount, date: new Date(at).toISOString(), device: SAMPLE_DEVICE,
  ...(missed.length ? { missed: missed.map(word => ({ word, count: 1 })) } : {}),
})

/**
 * The sample lists at now, in the week that starts at weekStart (a time no later than now): eight runs spread evenly
 * between its start and now (so the week's summary is filled on any day), and three in the week before (so the
 * comparison with last week has something to compare).
 */
export function sampleLists(now: Date, weekStart: number): SavedWordList[] {
  const thisWeek = (slot: number) => weekStart + (now.getTime() - weekStart) * slot / 9
  const lastWeek = (daysBefore: number) => weekStart - daysBefore * DAY + 21 * 60 * MINUTE
  const created = new Date(weekStart - 7 * DAY).toISOString()
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

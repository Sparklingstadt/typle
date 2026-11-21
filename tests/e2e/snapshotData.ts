import type { Page } from '@playwright/test'
import { guestWorkspace } from './guestData'

// Saved data for the snapshot tests (screenshots.spec.ts and aria-snapshots.spec.ts): a pack of two lists with
// records on two devices, dated from a fixed clock so that "today" and the days of the records are the same on every run.
// The tests that use it run in Asia/Tokyo (test.use({ timezoneId })), so 12:00 here is noon on the screen.
export const today = new Date('2026-11-01T12:00:00+09:00').getTime()
const minute = 60 * 1000
const day = 24 * 60 * minute
export const mac = { id: 'mac', name: 'MacBook Air', layout: 'JIS' }
export const hhkb = { id: 'hhkb', name: 'HHKB', layout: 'US' }
const word = (input: string, display = input, annotation = '') => ({ input, display, annotation })
const record = (id: string, time: number, accuracy: number, ago: number, device: typeof mac, wordCount = 3) =>
  ({ id, time, accuracy, mistakes: accuracy === 100 ? 0 : 1, wordCount, date: new Date(today - ago).toISOString(), device })
const library = [
  { id: 'basics', name: '基本の単語', group: '英単語', category: '語学', tags: ['英語'], createdAt: '2026-09-01',
    words: [word('apple', 'apple', 'りんご'), word('water', 'water', '水'), word('experience', 'experience', '経験')], records: [
      record('b1', 6.2, 100, 5 * minute, mac),
      record('b2', 7.8, 95.2, 2 * 60 * minute, hhkb),
      record('b3', 5.4, 100, day, mac),
      record('b4', 9.1, 90.5, 3 * day, hhkb),
    ] },
  { id: 'phrases', name: 'よく使う表現', group: '英単語', createdAt: '2026-09-02',
    words: [word('thank you', 'thank you', 'ありがとう'), word('good morning', 'good morning', 'おはよう')], records: [
      record('p1', 8.5, 100, 30 * minute, mac, 2),
    ] },
]

/** Fixes the clock at today and puts the saved data in this browser before the first page loads. */
export async function seedSaved(page: Page) {
  await page.clock.setFixedTime(today)
  await page.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, ['typle-r:guest-workspace:v1', guestWorkspace(library, { devices: [mac, hhkb] })])
}

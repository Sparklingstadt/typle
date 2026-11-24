import { test, expect, type Locator, type Page } from '@playwright/test'
import { guestWorkspace } from './guestData'
import zsh from '../../src/lib/packs/commands/macos-zsh-commands.json'

test('labels in a long pack chooser do not add blank space below the play page', async ({ page }) => {
  const lists = Array.from({ length: 40 }, (_, index) => ({
    id: `layout-${index}`, name: `Commands ${index}`, createdAt: '2026-09-01',
    category: 'プログラミング', tags: ['macOS', 'シェル'],
    words: index === 0 ? zsh.words : [{ display: 'pwd', input: 'pwd', annotation: '' }],
    records: [],
  }))
  await page.addInitScript(value => localStorage.setItem('typle-r:guest-workspace:v1', value), guestWorkspace(lists))

  for (const width of [1440, 1100, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/play?list=layout-0')
    const chooser = page.getByRole('list', { name: '単語リスト', exact: true })
    await expect(chooser.getByRole('button')).toHaveCount(40)
    await expect(chooser.locator('[data-list-labels]').first()).toContainText('カテゴリ')

    // Offscreen labels must stay inside the chooser's scroll area, including after scrolling it.
    const scrollBox = chooser.locator('..')
    expect(await scrollBox.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    for (const bottom of [false, true]) {
      await scrollBox.evaluate((element, bottom) => { element.scrollTop = bottom ? element.scrollHeight : 0 }, bottom)
      const geometry = await page.evaluate(() => ({
        pageBottom: document.documentElement.scrollHeight,
        contentBottom: Math.max(innerHeight, document.body.getBoundingClientRect().bottom + scrollY),
      }))
      expect(geometry.pageBottom).toBeLessThanOrEqual(Math.ceil(geometry.contentBottom) + 1)
    }
  }
})

// The header of the practice card is as wide as the window minus the sidebar (from 1280px) and the word list panel (from
// 1024px), so with both it is narrower at 1280px than at 1024px. Before v2.60.4 the list's name shrank to nothing
// there and its word count and arrows were drawn over the device menu.
const headerLists = ['基礎単語', '中級単語'].map((name, index) => ({
  id: `header-${index}`, name, group: '英語：基礎・中級', category: '語学', tags: ['英語'], createdAt: '2026-09-01', records: [],
  words: Array.from({ length: 40 }, (_, word) => ({ display: `word${word}`, input: `word${word}`, annotation: '' })),
}))
const longDevice = { id: 'hhkb', name: 'HHKB Professional HYBRID Type-S', layout: 'US' }

/** Opens /play at this width with the word list panel open or closed, and measures the header of the practice card. */
async function playHeader(page: Page, width: number, panelOpen: boolean) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/play?list=header-0')
  await page.evaluate(open => open ? localStorage.removeItem('typle-r:play-aside') : localStorage.setItem('typle-r:play-aside', 'collapsed'), panelOpen)
  await page.reload()
  const list = page.getByRole('button', { name: '単語リストを切り替える（現在: 英語：基礎・中級 › 基礎単語）', exact: true })
  await expect(list).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const box = async (locator: Locator) => (await locator.boundingBox())!
  const [listBox, device, restart] = await Promise.all([list, page.getByRole('button', { name: /^使用端末：/ }), page.getByRole('button', { name: '最初からやり直す', exact: true })].map(box))
  return {
    list: listBox, device, restart,
    // The name, the word count and the icons of the list button: the ones shown at this width.
    parts: await list.evaluate(button => [...button.children].map(child => child.getBoundingClientRect()).filter(rect => rect.width > 0).map(rect => rect.right)),
    nameWidth: await list.evaluate(button => [...button.children].find(child => child.textContent?.includes('基礎単語'))!.getBoundingClientRect().width),
    cardRight: await list.evaluate(button => button.closest('[data-slot="card"]')!.getBoundingClientRect().right),
  }
}

for (const device of ['the built-in device', 'a device with a long name']) {
  test(`the list name and the device menu do not overlap in the play header with ${device}`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('typle-r:guest-workspace:v1', value), guestWorkspace(headerLists, { devices: [longDevice] }))
    if (device !== 'the built-in device') {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/play?list=header-0')
      await page.getByRole('button', { name: '使用端末：デフォルト', exact: true }).click()
      await page.getByRole('menuitemradio', { name: /^HHKB/ }).click()
      await expect(page.getByRole('button', { name: /^使用端末：HHKB/ })).toBeVisible()
    }
    for (const panelOpen of [true, false]) {
      for (const width of [1280, 1024, 1440, 640, 390]) {
        const header = await playHeader(page, width, panelOpen)
        await expect(page.getByRole('button', { name: device === 'the built-in device' ? '使用端末：デフォルト' : /^使用端末：HHKB/, exact: true })).toBeVisible()
        const where = `${width}px, panel ${panelOpen ? 'open' : 'closed'}`
        // Nothing of the list button is drawn outside it, and it ends before the device menu starts.
        for (const right of header.parts) expect(right, where).toBeLessThanOrEqual(header.list.x + header.list.width + 0.5)
        expect(header.list.x + header.list.width, where).toBeLessThanOrEqual(header.device.x + 0.5)
        // A few characters of the name stay readable (48px is three of its characters), and no button leaves the card.
        expect(header.nameWidth, where).toBeGreaterThanOrEqual(48)
        expect(header.restart.x + header.restart.width, where).toBeLessThanOrEqual(header.cardRight + 0.5)
      }
    }
  })
}

test('the play header shows the word count and the recall label only when it has room for them', async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('typle-r:guest-workspace:v1', value), guestWorkspace(headerLists))
  const recallLabel = page.getByRole('button', { name: '思い出して打つ', exact: true }).getByText('思い出して打つ', { exact: true })
  const wordCount = page.getByRole('button', { name: /^単語リストを切り替える/ }).getByText('40語', { exact: true })
  // [width, panel open, word count shown, recall label shown]
  for (const [width, panelOpen, count, label] of [[1280, true, false, false], [1280, false, true, true], [1440, true, true, false], [1024, true, false, false], [1024, false, true, true]] as const) {
    await playHeader(page, width, panelOpen)
    await expect(wordCount, `word count at ${width}px`).toBeVisible({ visible: count })
    await expect(recallLabel, `recall label at ${width}px`).toBeVisible({ visible: label })
  }
})

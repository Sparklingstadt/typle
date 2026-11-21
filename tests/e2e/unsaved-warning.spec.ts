import { test, expect, type Page } from '@playwright/test'
import { guestWorkspace } from './guestData'

// Closing or reloading the tab with changes that are not saved: the browser asks first (src/hooks/useUnsavedWarning.ts).
// Leaving through the app's own links and buttons is asked by the app's dialog, in word-editor.spec.ts and packs.spec.ts.

/** Whether the page asks before it is closed or reloaded: its beforeunload handler cancels the event. */
const asksBeforeLeaving = (page: Page) => page.evaluate(() => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
})

test('the list editor asks before the tab is closed only while it has changes that are not saved', async ({ page }) => {
  await page.goto('/create')
  const name = page.getByRole('textbox', { name: '単語リスト名', exact: true })
  await expect(name).toBeVisible()
  expect(await asksBeforeLeaving(page)).toBe(false)

  await name.fill('Draft')
  await expect.poll(() => asksBeforeLeaving(page)).toBe(true)
  // The browser's own question: staying keeps the page and the draft.
  const dialogs: string[] = []
  page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss() })
  await page.close({ runBeforeUnload: true })
  await expect.poll(() => dialogs).toEqual(['beforeunload'])
  expect(page.isClosed()).toBe(false)
  await expect(name).toHaveValue('Draft')

  // Taking the change back leaves nothing to lose.
  await name.fill('')
  await expect.poll(() => asksBeforeLeaving(page)).toBe(false)

  // Neither does a saved list.
  await name.fill('Draft')
  await page.getByRole('textbox', { name: '表示する単語 1', exact: true }).fill('a')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL(/\/edit\?pack=/)
  expect(await asksBeforeLeaving(page)).toBe(false)
  expect(dialogs).toEqual(['beforeunload'])
})

test('the pack editor asks before the tab is closed while it has changes that are not saved', async ({ page }) => {
  // A pack is made of saved lists, so the form needs one.
  const list = { id: 'kana', name: 'Kana', createdAt: '2026-09-02', words: [{ display: 'a', input: 'a', annotation: '' }], records: [] }
  await page.addInitScript(([key, raw]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, raw)
  }, ['typle-r:guest-workspace:v1', guestWorkspace([list])])
  await page.goto('/packs/create')
  const name = page.getByRole('textbox', { name: 'パック名', exact: false })
  await expect(name).toBeVisible()
  expect(await asksBeforeLeaving(page)).toBe(false)
  await name.fill('Mix')
  await expect.poll(() => asksBeforeLeaving(page)).toBe(true)
  await name.fill('')
  await expect.poll(() => asksBeforeLeaving(page)).toBe(false)
})

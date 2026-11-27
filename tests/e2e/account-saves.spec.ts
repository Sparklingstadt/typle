import { test, expect, type Page } from '@playwright/test'
import { cookieName, deleteWorkspace, newAccountId, origin, sessionFor, signIn } from './account'
import { openPacks } from './packRows'

// What a signed-in user does on the screens reaches the account: the other signed-in specs seed and read through the
// API, and the guest specs save to this browser. Here the screens themselves send the saves to /api/workspace and
// /api/workspace/records.
const guestKey = 'typle-r:guest-workspace:v1'
let accountId = ''
test.beforeEach(async ({ context }) => {
  accountId = newAccountId()
  await signIn(context, accountId)
})
test.afterEach(async () => {
  await deleteWorkspace(accountId)
})

type Saved = { revision: number, lists: { id: string, name: string, words: { display: string }[], records: { id: string }[] }[], packs: unknown }
const saved = async (page: Page): Promise<Saved> => (await page.request.get('/api/workspace')).json()
const listName = (page: Page) => page.getByRole('textbox', { name: '単語リスト名', exact: true })
const saveButton = (page: Page) => page.getByRole('button', { name: '保存', exact: true })

/** Saves one list of the account through the API, as another screen would have. */
async function seed(page: Page, name: string) {
  const list = { id: 'seeded', name, createdAt: '2026-09-06', records: [], words: [{ display: 'a', input: 'a', annotation: '' }] }
  const response = await page.request.put('/api/workspace', { headers: { Origin: origin }, data: { accountId, revision: 0, lists: [list] } })
  expect(response.status()).toBe(200)
}

test('a signed-in user creates and renames a list, practises it and deletes the record, all saved to the account', async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/workspace') && request.method() !== 'GET') requests.push(`${request.method()} ${url.pathname}`)
  })
  page.on('pageerror', error => errors.push(error.message))

  await page.goto('/create')
  await listName(page).fill('Cloud')
  await page.getByRole('textbox', { name: '表示する単語 1', exact: true }).fill('a')
  await saveButton(page).click()
  await expect(page).toHaveURL(/\/edit\?pack=/)
  let account = await saved(page)
  expect(account.lists.map(list => [list.name, list.words.map(word => word.display)])).toEqual([['Cloud', ['a']]])
  expect(requests).toEqual(['PUT /api/workspace'])

  // A reload reads the list back from the account, and a change of it is saved there too.
  await page.reload()
  await openPacks(page)
  await page.getByRole('button', { name: 'Cloud を編集', exact: true }).click()
  await listName(page).fill('Cloud saved')
  await saveButton(page).click()
  await expect(page).toHaveURL(/\/edit\?pack=/)
  account = await saved(page)
  expect(account.lists.map(list => list.name)).toEqual(['Cloud saved'])
  expect(account.revision).toBe(2)

  // A finished run is sent on its own, without a revision.
  await page.goto('/play')
  await expect(page.getByRole('button', { name: 'Cloud saved を選択中', exact: true })).toBeVisible()
  const input = page.getByRole('textbox', { name: '表示された文字を入力', exact: true })
  await expect(input).toBeFocused()
  await input.pressSequentially('a')
  await expect(page.getByLabel('練習結果', { exact: true })).toContainText('練習記録を保存しました。')
  account = await saved(page)
  expect(account.lists[0].records).toHaveLength(1)
  expect(requests.at(-1)).toBe('POST /api/workspace/records')

  // The record is there after a reload, and deleting it deletes it from the account.
  await page.goto('/records')
  await page.reload()
  const rows = page.locator('[data-record-key]')
  await expect(rows).toHaveCount(1)
  await rows.first().getByRole('button', { name: /の記録を削除$/ }).click()
  await page.getByRole('alertdialog', { name: 'この練習記録を削除しますか？' }).getByRole('button', { name: '削除する' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'を削除しました。' })).toBeVisible()
  await expect(rows).toHaveCount(0)
  account = await saved(page)
  expect(account.lists[0].records).toEqual([])
  expect(requests.at(-1)).toBe('DELETE /api/workspace/records')

  // Nothing of the account was kept in this browser.
  expect(await page.evaluate(key => localStorage.getItem(key), guestKey)).toBeNull()
  expect(errors).toEqual([])
})

test('a save refused because another screen saved first says so, keeps the draft, and goes through when sent again', async ({ page }) => {
  await seed(page, 'Shared')
  await page.goto('/edit')
  await openPacks(page)
  await page.getByRole('button', { name: 'Shared を編集', exact: true }).click()
  await listName(page).fill('Mine')

  // Another screen of the account saves a word meanwhile, so this screen's revision is no longer the saved one.
  const before = await saved(page)
  const theirs = { ...before.lists[0], words: [{ display: 'b', input: 'b', annotation: '' }] }
  const other = await page.request.put('/api/workspace', { headers: { Origin: origin },
    data: { accountId, revision: before.revision, packs: before.packs, lists: [theirs] } })
  expect(other.status()).toBe(200)

  await saveButton(page).click()
  await expect(page.getByRole('alert').filter({ hasText: '別の画面で更新されています。最新データを読み込んでから再試行してください。' })).toBeVisible()
  await expect(listName(page)).toHaveValue('Mine')
  await expect(page).toHaveURL(/\/edit\?list=seeded$/)
  expect((await saved(page)).lists.map(list => list.name)).toEqual(['Shared'])

  // The refusal read the latest data, so the same save now starts from the saved revision.
  await saveButton(page).click()
  await expect(page).toHaveURL(/\/edit(\?pack=[^&]*)?$/)
  expect((await saved(page)).lists.map(list => list.name)).toEqual(['Mine'])
})

test('an open screen shows itself signed out once the login was ended on another device', async ({ page, playwright }) => {
  await seed(page, 'Private')
  await page.goto('/edit')
  await openPacks(page)
  await expect(page.getByRole('button', { name: 'Private を編集', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'アカウントメニュー', exact: true })).toBeVisible()

  // Another device of the account signs out of every device; this browser keeps its cookie.
  const elsewhere = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin, Cookie: `${cookieName}=${await sessionFor(accountId)}` } })
  expect((await elsewhere.post('/api/account/signout-everywhere')).status()).toBe(204)
  await elsewhere.dispose()

  // Coming back to the window reads the workspace again: the 401 makes the screen read its login again.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'アカウントメニュー', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Private を編集', exact: true })).toHaveCount(0)
  await expect(page.getByRole('banner', { name: 'トップバー' })).toContainText('このブラウザーに保存')
})

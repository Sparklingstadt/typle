import { test, expect, type Page } from '@playwright/test'
import { guestWorkspace } from './guestData'

// The handwriting pad reads the strokes in the browser with the Korean model (src/lib/handwritingRecognizer.ts).
// The strokes below draw 아, 이 and 오 the way a hand would, so this runs the real model.

const key = 'typle-r:guest-workspace:v1'
const korean = {
  id: 'ko', name: 'Ko', createdAt: '2026-11-04', records: [], writing: { language: 'ko' },
  words: [{ display: '아이', input: 'ai', annotation: '' }, { display: '오이', input: 'oi', annotation: '' }],
}

type Point = { x: number; y: number }
const circle = (cx: number, cy: number, r: number): Point[] =>
  Array.from({ length: 25 }, (_, i) => ({ x: cx + r * Math.cos(i / 24 * 2 * Math.PI - Math.PI / 2), y: cy + r * Math.sin(i / 24 * 2 * Math.PI - Math.PI / 2) }))
const line = (x1: number, y1: number, x2: number, y2: number): Point[] =>
  Array.from({ length: 10 }, (_, i) => ({ x: x1 + (x2 - x1) * i / 9, y: y1 + (y2 - y1) * i / 9 }))
// The strokes of a syllable in a square at (x, y) of side s.
const syllables: Record<string, (x: number, y: number, s: number) => Point[][]> = {
  아: (x, y, s) => [circle(x + s * 0.3, y + s * 0.5, s * 0.22), line(x + s * 0.7, y + s * 0.1, x + s * 0.7, y + s * 0.9), line(x + s * 0.7, y + s * 0.5, x + s * 0.88, y + s * 0.5)],
  이: (x, y, s) => [circle(x + s * 0.3, y + s * 0.5, s * 0.22), line(x + s * 0.72, y + s * 0.1, x + s * 0.72, y + s * 0.9)],
  오: (x, y, s) => [circle(x + s * 0.5, y + s * 0.3, s * 0.2), line(x + s * 0.5, y + s * 0.52, x + s * 0.5, y + s * 0.7), line(x + s * 0.1, y + s * 0.72, x + s * 0.9, y + s * 0.72)],
}

const pad = (page: Page) => page.getByRole('img', { name: '手書きパッド', exact: true })
const model = (page: Page) => page.locator('#wordDisplay')

async function draw(page: Page, stroke: Point[]) {
  await page.mouse.move(stroke[0].x, stroke[0].y)
  await page.mouse.down()
  for (const point of stroke.slice(1)) await page.mouse.move(point.x, point.y)
  await page.mouse.up()
}

async function write(page: Page, text: string) {
  const box = await pad(page).boundingBox()
  if (!box) throw new Error('No pad')
  const side = box.height * 0.7
  let x = box.x + box.width / 2 - side * [...text].length / 2
  for (const syllable of text) {
    for (const stroke of syllables[syllable](x, box.y + box.height * 0.15, side)) await draw(page, stroke)
    x += side * 1.05
  }
}

const hint = (page: Page) => page.getByText('ここに書く', { exact: true })

/** Opens the list in handwriting mode, with the pad chosen. */
async function open(page: Page) {
  await page.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, [key, guestWorkspace([korean])])
  await page.goto('/play?list=ko')
  await page.getByRole('radio', { name: 'Handwriting', exact: true }).click()
  await expect(page.getByRole('radio', { name: '手書きパッド', exact: true })).toBeChecked()
}

async function start(page: Page) {
  await open(page)
  // The model is loaded when the hint shows.
  await expect(hint(page)).toBeVisible({ timeout: 30000 })
  await expect(model(page)).toHaveText('아이')
}

test('a word written on the pad is read and moves on', async ({ page }) => {
  await start(page)
  await write(page, '아이')
  await expect(model(page)).toHaveText('오이')
  await write(page, '오이')
  const result = page.getByLabel('練習結果', { exact: true })
  await expect(result).toContainText('Handwriting')
  await expect(result).toContainText('100%')
})

test('a wrong word counts a mistake on Enter, and the pad can be cleared', async ({ page }) => {
  await start(page)
  await write(page, '이')
  await page.keyboard.press('Enter')
  await expect(page.getByText(/と読めました$/)).toBeVisible()
  await expect(model(page)).toHaveText('아이')
  await page.getByRole('button', { name: '消す', exact: true }).click()
  await expect(page.getByText('ここに書く', { exact: true })).toBeVisible()
  await write(page, '아이')
  await expect(model(page)).toHaveText('오이')
})

test('the text field can be chosen instead, and the choice is kept', async ({ page }) => {
  await start(page)
  await page.getByRole('radio', { name: '入力欄', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'ここに手書きで入力', exact: true })
  await field.fill('아이')
  await expect(model(page)).toHaveText('오이')
  await page.reload()
  await page.getByRole('radio', { name: 'Handwriting', exact: true }).click()
  await expect(page.getByRole('radio', { name: '入力欄', exact: true })).toBeChecked()
  await expect(pad(page)).toHaveCount(0)
})

test('the text around the pad cannot be selected while writing, and can with the field', async ({ page }) => {
  await start(page)
  const selected = async () => {
    await page.evaluate(() => getSelection()?.removeAllRanges())
    await model(page).dblclick()
    return page.evaluate(() => getSelection()?.toString())
  }
  expect(await selected()).toBe('')
  await page.getByRole('radio', { name: '入力欄', exact: true }).click()
  expect(await selected()).not.toBe('')
})

test('a model that cannot be loaded says so, and is loaded when asked again', async ({ page }) => {
  let requests = 0
  const modelFile = '**/handwriting/ko/*.onnx'
  await page.route(modelFile, route => { requests++; return route.abort() })
  await open(page)
  const failed = page.getByRole('status').filter({ hasText: '手書きの認識を読み込めませんでした。' })
  await expect(failed).toBeVisible({ timeout: 30000 })
  // Nothing can be written or judged meanwhile.
  await expect(page.getByRole('button', { name: '判定', exact: true })).toBeDisabled()
  await expect(hint(page)).toHaveCount(0)
  expect(requests).toBe(1)

  // A failed load is not kept: asking again fetches the model again, and fails again while it cannot be reached.
  await failed.getByRole('button', { name: 'もう一度読み込む', exact: true }).click()
  await expect.poll(() => requests).toBe(2)
  await expect(failed).toBeVisible({ timeout: 30000 })

  await page.unroute(modelFile)
  await failed.getByRole('button', { name: 'もう一度読み込む', exact: true }).click()
  await expect(hint(page)).toBeVisible({ timeout: 30000 })
  await expect(failed).toHaveCount(0)
  await write(page, '아이')
  await expect(model(page)).toHaveText('오이')
})

test('the last stroke is taken back with Ctrl+Z and with 1画戻す', async ({ page }) => {
  await start(page)
  const undo = page.getByRole('button', { name: '1画戻す', exact: true })
  const clear = page.getByRole('button', { name: '消す', exact: true })
  await expect(undo).toBeDisabled()
  await expect(clear).toBeDisabled()
  const box = await pad(page).boundingBox()
  if (!box) throw new Error('No pad')
  const stroke = (offset: number) => line(box.x + 30 + offset, box.y + 40, box.x + 70 + offset, box.y + 60)

  // One stroke, taken back with the keyboard: the pad is empty again.
  await draw(page, stroke(0))
  await expect(hint(page)).toBeHidden()
  await expect(undo).toBeEnabled()
  await page.keyboard.press('Control+z')
  await expect(hint(page)).toBeVisible()
  await expect(undo).toBeDisabled()

  // Two strokes: the button takes back one at a time.
  await draw(page, stroke(0))
  await draw(page, stroke(60))
  await undo.click()
  await expect(hint(page)).toBeHidden()
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(hint(page)).toBeVisible()
  await expect(undo).toBeDisabled()
  // The word is still the first one, and can be written.
  await expect(model(page)).toHaveText('아이')
  await write(page, '아이')
  await expect(model(page)).toHaveText('오이')
})

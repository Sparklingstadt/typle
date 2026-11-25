import type { Page } from '@playwright/test'
import { WELCOME_DISMISSED_KEY } from '../../src/lib/welcome'

/** Marks the tour as seen for this account before the app runs, so a new workspace is not sent to /welcome. */
export function skipWelcome(page: Page, accountId = 'guest:local') {
  return page.addInitScript(([key, id]) => {
    let marks: unknown = []
    try { marks = JSON.parse(localStorage.getItem(key) ?? '[]') } catch { /* start afresh */ }
    const list = Array.isArray(marks) ? marks : []
    if (!list.includes(id)) localStorage.setItem(key, JSON.stringify([...list, id]))
  }, [WELCOME_DISMISSED_KEY, accountId])
}

import { INTEREST_OPTIONS, normalizeInterests } from './interests'
import { officialPacks, type OfficialPack } from './packs/catalog'

// Child interest id -> the catalog pack that is easiest to start with.
// A unit test checks that every child has one, that it exists and that it fits the interest.
export const WELCOME_PACKS: Readonly<Record<string, string>> = {
  'language/zh': 'pack-chinese-basics',
  'language/ru': 'pack-russian-basic-words',
  'language/ko': 'pack-korean-basics',
  'language/en': 'pack-english-basic-words',
  'language/es': 'pack-spanish-basics',
  'language/fr': 'pack-french-basics',
  'language/de': 'pack-german-basics',
  'language/cs': 'pack-czech-basics',
  'language/ja': 'pack-japanese-romaji-beginner',
  'programming/go': 'pack-go-syntax-beginner',
  'programming/kotlin': 'pack-kotlin-syntax-beginner-1',
  'programming/java': 'pack-java-syntax-beginner',
  'programming/typescript': 'pack-typescript-syntax-beginner',
  'programming/php': 'pack-php-syntax-beginner',
  'programming/ruby': 'pack-rails-methods-beginner',
  'programming/sql': 'pack-postgresql-syntax-beginner',
  'programming/linux': 'pack-0b27f311-38aa-40aa-9c29-ea17e374e1fe',
  'programming/vim': 'pack-vim-beginner',
  'programming/test': 'pack-jest-syntax-beginner',
  'programming/node': 'pack-express-methods-beginner',
  // zsh, not Linux, so that it does not overlap with programming/linux
  'programming/shell': 'pack-8f3cf116-1f9f-4579-a071-e600094b104d',
  'programming/cloud': 'pack-ef974a4b-3c7a-4eeb-9979-6721a0a1c81a',
}

// Packs for the chosen child interests, in INTEREST_OPTIONS order, without duplicates.
export function welcomePacks(interests: string[]): OfficialPack[] {
  const wanted: string[] = []
  for (const option of INTEREST_OPTIONS) {
    for (const child of option.children) {
      const catalogId = WELCOME_PACKS[child.id]
      if (interests.includes(child.id) && catalogId && !wanted.includes(catalogId)) wanted.push(catalogId)
    }
  }
  const entries = officialPacks()
  return wanted.flatMap(catalogId => entries.find(entry => entry.catalogId === catalogId) ?? [])
}

export function hasChildInterest(interests: string[]): boolean {
  return INTEREST_OPTIONS.some(option => option.children.some(child => interests.includes(child.id)))
}

// The name of each language in its own script, shown on the tour's keys above the translated name.
export const NATIVE_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  'language/zh': '中文', // i18n-ignore
  'language/ru': 'Русский', // i18n-ignore
  'language/ko': '한국어', // i18n-ignore
  'language/en': 'English',
  'language/es': 'Español',
  'language/fr': 'Français',
  'language/de': 'Deutsch',
  'language/cs': 'Čeština',
  'language/ja': '日本語', // i18n-ignore
}

// The tour shows parents as headings: picking a child picks its parent, and dropping the last child drops the parent.
// /interests keeps toggleInterest, where the parent is picked first.
export function toggleWelcomeInterest(interests: string[], childId: string): string[] {
  const option = INTEREST_OPTIONS.find(item => item.children.some(child => child.id === childId))
  if (!option) return interests
  if (!interests.includes(childId)) return normalizeInterests([...interests, option.id, childId])
  const rest = interests.filter(id => id !== childId)
  const keepsChild = option.children.some(child => rest.includes(child.id))
  return normalizeInterests(keepsChild ? rest : rest.filter(id => id !== option.id))
}

export type WelcomeStep = 'interests' | 'packs' | 'start'
export type WelcomeKeyAction = { kind: 'primary' } | { kind: 'later' } | { kind: 'back' } | { kind: 'toggle', index: number } | null
export type WelcomeKey = {
  key: string
  isComposing: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  // A key held down repeats; only the first press counts, so holding Enter never follows packs unseen.
  repeat: boolean
  // A menu or dialog that handled the key (Radix closes on Escape and prevents its default).
  defaultPrevented: boolean
  // What has the focus: Enter on a link or on a button other than a key is left to that element, and keys pressed
  // outside the tour (the navigation, a menu, a dialog) are not the tour's.
  targetKind: 'link' | 'otherButton' | 'outside' | 'none'
}
// 'saving': a save is running. 'retry': the packs are followed but the interests were not saved.
export type WelcomeKeyState = 'idle' | 'saving' | 'retry'

// The tour's keyboard: Enter for the step's main button, Esc for 「あとで」, ← back to the interests, 1-9 to check packs.
export function welcomeKey(event: WelcomeKey, step: WelcomeStep, packCount: number, state: WelcomeKeyState): WelcomeKeyAction {
  if (state === 'saving' || event.repeat || event.defaultPrevented || event.targetKind === 'outside') return null
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === 'Enter') return event.targetKind === 'none' ? { kind: 'primary' } : null
  if (event.key === 'Escape') return step === 'start' ? null : { kind: 'later' }
  if (state === 'retry') return null
  if (event.key === 'ArrowLeft') return step === 'packs' ? { kind: 'back' } : null
  if (step === 'packs' && /^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1
    return index < packCount ? { kind: 'toggle', index } : null
  }
  return null
}

// Checks after the interests changed: packs that stay keep their check, new packs come checked.
export function carryChecks(previous: ReadonlySet<string>, before: string[], after: string[]): Set<string> {
  return new Set(after.filter(id => !before.includes(id) || previous.has(id)))
}

// How much of the input the tour's typing demo has typed after elapsedMs, by code point.
export function demoProgress(input: string, elapsedMs: number, msPerChar: number): string {
  const characters = Array.from(input)
  return characters.slice(0, Math.min(characters.length, Math.floor(elapsedMs / msPerChar))).join('')
}

export function shouldWelcome(state: { revision: number | null; dismissed: boolean }): boolean {
  return state.revision === 0 && !state.dismissed
}

// Value: a JSON array of account ids that have seen or skipped the tour.
export const WELCOME_DISMISSED_KEY = 'typle-r:welcome-dismissed'

// localStorage is missing on the server and may be denied in the browser; both count as unavailable.
function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function readMarks(storage: Storage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(WELCOME_DISMISSED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

// Accounts dismissed during this page session, so 「あとで」 works even when the mark cannot be written.
const dismissedThisSession = new Set<string>()

export function isWelcomeDismissed(accountId: string, storage: Storage | undefined = defaultStorage()): boolean {
  if (dismissedThisSession.has(accountId)) return true
  return storage ? readMarks(storage).includes(accountId) : false
}

export function dismissWelcome(accountId: string, storage: Storage | undefined = defaultStorage()): void {
  dismissedThisSession.add(accountId)
  if (!storage) return
  try {
    const marks = readMarks(storage)
    if (marks.includes(accountId)) return
    storage.setItem(WELCOME_DISMISSED_KEY, JSON.stringify([...marks, accountId]))
  } catch {
    // The mark is a convenience; without it the tour may show again.
  }
}

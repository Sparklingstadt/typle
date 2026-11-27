import { INTEREST_OPTIONS } from './interests'
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

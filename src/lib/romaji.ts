// Romaji input for Japanese kana. A word's input holds the kana (hiragana or katakana); every common spelling is
// accepted (shi, si and ci for し; tsu and tu for つ; sha, sya and shixya for しゃ), the way Japanese typing practice
// usually works with the input method turned off. The first spelling of each entry is the one shown as a guide.
import table from './romajiTable.json'

// The tables are kept in JSON, as kana in source files would read as untranslated text.
const SINGLE: Readonly<Record<string, readonly string[]>> = table.single
const DOUBLE: Readonly<Record<string, readonly string[]>> = table.double
// Full-width marks typed with the key of their half-width form.
const SYMBOLS: Readonly<Record<string, string>> = table.symbols
export const SYLLABIC_N = table.syllabicN
export const SMALL_TSU = table.smallTsu
// Kana with more than one spelling, and small kana typed on their own: the examples of the input page.
export const ROMAJI_EXAMPLES: readonly string[] = table.examples

function toHiragana(char: string) {
  const code = char.codePointAt(0) ?? 0
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char
}

export type KanaCandidate = { kana: string; romaji: string }

// The keys that type the kana at `position`: each entry covers one kana or two typed together. Null when that character
// has no romaji spelling (kanji, Latin letters), which is typed as it is.
export function kanaCandidates(chars: readonly string[], position: number): KanaCandidate[] | null {
  const char = chars[position]
  if (char === undefined) return null
  if (SYMBOLS[char]) return [{ kana: char, romaji: SYMBOLS[char] }]
  const hiragana = toHiragana(char)
  if (hiragana === SYLLABIC_N.kana) {
    // A single n is enough before a consonant other than n and y; before a vowel, y or n it would read as another kana.
    const next = nextFirstKeys(chars, position + 1)
    const single = next.length > 0 && next.every(key => !/[aiueoyn']/.test(key))
    return (single ? ['n', ...SYLLABIC_N.romaji] : SYLLABIC_N.romaji).map(romaji => ({ kana: char, romaji }))
  }
  if (hiragana === SMALL_TSU.kana) {
    // Doubling the consonant of the next kana types っ; the first consonant of its first spelling is the guide.
    const doubled = [...new Set(nextFirstKeys(chars, position + 1).filter(key => /^[bcdfghjkmpqrstvwz]$/.test(key)))]
    return [...doubled, ...SMALL_TSU.romaji].map(romaji => ({ kana: char, romaji }))
  }
  const candidates: KanaCandidate[] = []
  const following = chars[position + 1]
  if (following !== undefined) {
    for (const romaji of DOUBLE[hiragana + toHiragana(following)] ?? []) candidates.push({ kana: char + following, romaji })
  }
  for (const romaji of SINGLE[hiragana] ?? []) candidates.push({ kana: char, romaji })
  return candidates.length ? candidates : null
}

// The first key of each way to type the kana at `position`, the first spelling's first.
function nextFirstKeys(chars: readonly string[], position: number) {
  return (kanaCandidates(chars, position) ?? []).map(candidate => candidate.romaji[0])
}

export type KanaStep = { committed: string; pending: string; ok: boolean }

/**
 * Feeds one key to the kana at `position`, after the keys in `pending` were accepted for it. A key that completes a
 * spelling commits its kana; one that can still lead to a spelling is kept pending. A spelling that is complete but could
 * still go on (n for ん before a consonant, as nn also types it) is committed when the next key does not continue it,
 * and that key goes on to the next kana. `ok` is false for a wrong key. Null when the character is not typed in romaji.
 */
export function feedKana(chars: readonly string[], position: number, pending: string, key: string): KanaStep | null {
  const candidates = kanaCandidates(chars, position)
  if (!candidates) return null
  const typed = pending + key.toLowerCase()
  const continuing = candidates.filter(candidate => candidate.romaji.startsWith(typed))
  if (continuing.length) {
    const complete = continuing.find(candidate => candidate.romaji === typed)
    if (complete && continuing.every(candidate => candidate.romaji === typed)) return { committed: complete.kana, pending: '', ok: true }
    return { committed: '', pending: typed, ok: true }
  }
  const complete = pending ? candidates.find(candidate => candidate.romaji === pending) : undefined
  if (complete) {
    const next = feedKana(chars, position + Array.from(complete.kana).length, '', key)
    return next ? { ...next, committed: complete.kana + next.committed } : { committed: complete.kana, pending: '', ok: false }
  }
  return { committed: '', pending, ok: false }
}

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u

// Whether a word's input is kana typed in romaji: it has kana, and every character has a romaji spelling or is a key
// (Latin letters, digits and ASCII marks).
export function isRomajiTarget(target: string) {
  const chars = Array.from(target)
  if (!chars.some(char => KANA.test(char) && SYMBOLS[char] === undefined)) return false
  return chars.every((char, index) => /^[\x20-\x7e]$/.test(char) || kanaCandidates(chars, index) !== null)
}

/**
 * A romaji guide for the word: `typed` is the keys typed so far, `rest` a spelling of what is left that follows the keys
 * pending for the current kana. Null when the word is not typed in romaji.
 */
export function romajiGuide(target: string, position: number, typed: string, pending: string) {
  if (!isRomajiTarget(target)) return null
  const chars = Array.from(target)
  let index = position
  let rest = ''
  const current = pending ? kanaCandidates(chars, index)?.find(candidate => candidate.romaji.startsWith(pending)) : undefined
  if (current) {
    rest += current.romaji.slice(pending.length)
    index += Array.from(current.kana).length
  }
  while (index < chars.length) {
    const first = kanaCandidates(chars, index)?.[0]
    rest += first ? first.romaji : chars[index]
    index += first ? Array.from(first.kana).length : 1
  }
  return { typed, rest }
}

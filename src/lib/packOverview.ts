import { listOverviews, matchesQuery, type ListOrder, type ListOverview } from './listOverview'
import { viewLists, type Library, type WordPack } from './wordPacks'

// Packs as the lists screen shows them: with their lists, counts and last practice, found by a search and sorted.

export type PackOverview = {
  pack: WordPack
  /** The lists inside, in the shape screens use, in saved order. */
  lists: ListOverview[]
  /** Place in `packs` (saved order). */
  position: number
  wordCount: number
  practiceCount: number
  practicedListCount: number
  lastPracticed: number | null
}

export function packOverviews(library: Library): PackOverview[] {
  const overviews = listOverviews(viewLists(library))
  return library.packs.map((pack, position) => {
    const lists = overviews.filter(item => item.list.packId === pack.id)
    const dates = lists.map(item => item.lastPracticed).filter((date): date is number => date !== null)
    return {
      pack, lists, position,
      wordCount: lists.reduce((sum, item) => sum + item.list.words.length, 0),
      practiceCount: lists.reduce((sum, item) => sum + item.practiceCount, 0),
      practicedListCount: lists.filter(item => item.practiceCount > 0).length,
      lastPracticed: dates.length ? Math.max(...dates) : null,
    }
  })
}

/** Finds by the pack name, category and tags, and the names and words of the lists inside, without case. */
export function matchesPackQuery(item: PackOverview, query: string) {
  const needle = query.trim().toLocaleLowerCase()
  return !needle || item.pack.name.toLocaleLowerCase().includes(needle) || item.lists.some(({ list }) => matchesQuery(list, query))
}

/** The lists inside that the list name or a word found, so the screen can open the pack to show them. */
export function matchingListIds(item: PackOverview, query: string) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  return item.lists.filter(({ list }) => list.name.toLocaleLowerCase().includes(needle) ||
    list.words.some(word => word.display.toLocaleLowerCase().includes(needle) || word.input.toLocaleLowerCase().includes(needle)))
    .map(({ list }) => list.id)
}

// Newest first for 'added'. Packs without a record come after the practised ones for 'practiced'.
export function sortPacks(items: PackOverview[], order: ListOrder, locale: string) {
  const collator = new Intl.Collator(locale, { numeric: true })
  return [...items].sort((a, b) => {
    if (order === 'name') return collator.compare(a.pack.name, b.pack.name) || b.position - a.position
    if (order === 'words') return b.wordCount - a.wordCount || b.position - a.position
    if (order === 'practiced') return (b.lastPracticed ?? -Infinity) - (a.lastPracticed ?? -Infinity) || b.position - a.position
    return b.position - a.position
  })
}

/** The lists of a pack the screen shows for a search. */
export function visibleListRows(item: PackOverview, query: string): PackOverview['lists'] {
  // A search that found lists by their name or words shows those; one that found the pack by its name or labels shows all.
  const found = new Set(matchingListIds(item, query))
  const byName = !!query.trim() && item.pack.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  return found.size && !byName ? item.lists.filter(row => found.has(row.list.id)) : item.lists
}

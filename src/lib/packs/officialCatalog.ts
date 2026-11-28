import { applyCatalogChoices as applyChoices, catalogEntries as entriesOf, type CatalogChoice } from '../catalogChoices'
import { followOfficial, followPack, isFollowed, type OfficialPack } from '../followedPacks'
import type { NewPackIds } from '../packFile'
import { isInputType, type SavedWordList } from '../wordLists'
import type { Library, WordPack } from '../wordPacks'
import { packFiles } from './loaders'
import summaries from './summary.json'

// The official packs as the browser reads them. The summary (made by scripts/generate-packs.cjs) has every pack
// without its words; the words of a pack are loaded when someone follows it or reads a workspace that follows it.
// The whole catalog with its words (catalog.ts) is about 1 MB of script and stays on the server.
export type { CatalogChoice }

/** A list of an official pack without its words: how many it has, and its first few as they are shown. */
export type ListSummary = Omit<SavedWordList, 'words'> & { wordCount: number; sample: string[] }
/** An official pack as the catalog's screens show it. */
export type PackSummary = { catalogId: string; version: number; pack: WordPack; lists: ListSummary[] }
/** `followed` when the library has a followed pack from this entry. */
export type CatalogEntry = PackSummary & { followed: boolean }

const all = summaries as PackSummary[]
const byId = new Map(all.map(entry => [entry.catalogId, entry]))
const loaded = new Map<string, OfficialPack>()
const loading = new Map<string, Promise<void>>()

export function packSummaries(): readonly PackSummary[] {
  return all
}

export function catalogEntries(library: Library): CatalogEntry[] {
  return entriesOf(library, all)
}

async function load(entry: PackSummary) {
  const files = await packFiles[entry.catalogId]()
  loaded.set(entry.catalogId, {
    catalogId: entry.catalogId, version: entry.version, pack: entry.pack,
    lists: entry.lists.map(({ wordCount: _wordCount, sample: _sample, ...list }, index) => ({
      ...list,
      words: files[index].default.words.map(word => {
        if (!isInputType(word.input_type)) throw new Error('Invalid official input_type')
        return { ...word, input_type: word.input_type }
      }),
    })),
  })
}

/** Loads the words of these official packs; an id the catalog does not have is passed over. A failed load is tried again when asked again. */
export async function loadOfficialPacks(catalogIds: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(catalogIds)].map(catalogId => {
    const entry = byId.get(catalogId)
    if (!entry || loaded.has(catalogId)) return undefined
    const running = loading.get(catalogId) ?? load(entry).finally(() => loading.delete(catalogId))
    loading.set(catalogId, running)
    return running
  }))
}

/** The catalog ids of the followed packs among `packs`. */
const followedIds = (packs: readonly WordPack[]) => packs.filter(isFollowed).map(pack => pack.origin!.catalogId)

/** Loads the words of the official packs that `packs` follow. */
export function loadFollowed(packs: readonly WordPack[]): Promise<void> {
  return loadOfficialPacks(followedIds(packs))
}

// Every official pack: one that is loaded with its words, the others with none. Only the lists of the packs a library
// follows are read from it, so callers load those first (catalogFor).
function catalog(): OfficialPack[] {
  return all.map(entry => loaded.get(entry.catalogId)
    ?? { catalogId: entry.catalogId, version: entry.version, pack: entry.pack, lists: entry.lists.map(({ wordCount: _wordCount, sample: _sample, ...list }) => ({ ...list, words: [] })) })
}

/**
 * The catalog to bring a library with these packs in line with (followOfficial), or null when the words of a pack they
 * follow are not loaded yet (loadFollowed).
 */
export function catalogFor(packs: readonly WordPack[]): OfficialPack[] | null {
  return followedIds(packs).every(catalogId => loaded.has(catalogId) || !byId.has(catalogId)) ? catalog() : null
}

// The catalog for following these packs; they are loaded first (loadOfficialPacks), like the packs already followed.
function catalogWith(library: Library, catalogIds: string[]): OfficialPack[] {
  const official = catalogFor(library.packs)
  if (!official || catalogIds.some(catalogId => byId.has(catalogId) && !loaded.has(catalogId))) throw new Error('The official packs to follow are not loaded')
  return official
}

/** The library as the screens show it: followed packs in line with the catalog, with the words they are saved without. */
export async function followed<T extends Library>(state: T): Promise<T> {
  await loadFollowed(state.packs)
  return { ...state, ...followOfficial({ lists: state.lists, packs: state.packs }, catalogFor(state.packs)!) }
}

/**
 * Follows an official pack whose words are loaded (loadOfficialPacks): it is added at the end, kept equal to the
 * official one, without records. The name gets （2）… when taken.
 */
export function followOfficialPack(library: Library, catalogId: string, ids: NewPackIds, now = new Date()): Library {
  return followPack(library, catalogWith(library, [catalogId]), catalogId, ids, now)
}

/** applyCatalogChoices of followedPacks.ts on this catalog; the packs to follow are loaded first (loadOfficialPacks). */
export function applyCatalogChoices(library: Library, choices: CatalogChoice[], ids: (entry: OfficialPack) => NewPackIds, now = new Date()): Library {
  return applyChoices(library, catalogWith(library, choices.filter(choice => choice.follow).map(choice => choice.catalogId)), choices, ids, now)
}

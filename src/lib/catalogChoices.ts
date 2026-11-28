import { followPack, isFollowed, type OfficialPack } from './followedPacks'
import { deletePack } from './packEditing'
import type { NewPackIds } from './packFile'
import type { Library } from './wordPacks'

// What the catalog's screens do with a catalog given to them: the server's whole one (packs/catalog.ts) in the tests,
// the browser's (packs/officialCatalog.ts) in the app.

/** Each entry of a catalog with `followed`: whether the library has a followed pack from it. */
export function catalogEntries<T extends { catalogId: string }>(library: Library, official: readonly T[]): (T & { followed: boolean })[] {
  return official.map(entry => ({
    ...entry, followed: library.packs.some(pack => isFollowed(pack) && pack.origin?.catalogId === entry.catalogId),
  }))
}

/** A switch of the interests screen: whether the library is to follow that official pack. */
export type CatalogChoice = { catalogId: string; follow: boolean }

/**
 * Makes the library follow exactly the chosen official packs among the choices: a pack switched on that is not followed
 * is followed (at the end, in the order of the choices), and a followed pack switched off is unfollowed, which deletes it
 * with its lists and records. `ids` gives the ids of a pack to follow.
 */
export function applyCatalogChoices(library: Library, official: OfficialPack[], choices: CatalogChoice[], ids: (entry: OfficialPack) => NewPackIds, now = new Date()): Library {
  let next = library
  for (const { catalogId, follow } of choices) {
    const followed = next.packs.find(pack => isFollowed(pack) && pack.origin?.catalogId === catalogId)
    if (follow && !followed) {
      const entry = official.find(item => item.catalogId === catalogId)
      next = followPack(next, official, catalogId, entry ? ids(entry) : { pack: '', lists: [] }, now)
    } else if (!follow && followed) {
      next = deletePack(next, followed.id)
    }
  }
  return next
}

import type { NewPackIds } from '../packFile'
import { followOfficial, followPack, isFollowed, type OfficialPack } from '../followedPacks'
import { deletePack } from '../packEditing'
import type { Library } from '../wordPacks'
import { officialLibrary } from './'

// The official packs are the packs an account can follow.
export type { OfficialPack }
/** `followed` when the library has a followed pack from this entry. */
export type CatalogEntry = OfficialPack & { followed: boolean }

// Built once: guest reads and writes follow the catalog every time. Callers only read it.
const official: OfficialPack[] = officialLibrary.packs.map(pack => ({
  catalogId: pack.origin!.catalogId, version: pack.origin!.version, pack,
  lists: officialLibrary.lists.filter(list => list.packId === pack.id),
}))

export function officialPacks(): OfficialPack[] {
  return official
}

/** The library as the screens show it: followed packs in line with the catalog, with the words they are saved without. */
export function followed<T extends Library>(state: T): T {
  return { ...state, ...followOfficial({ lists: state.lists, packs: state.packs }, officialPacks()) }
}

export function catalogEntries(library: Library): CatalogEntry[] {
  return officialPacks().map(entry => ({
    ...entry, followed: library.packs.some(pack => isFollowed(pack) && pack.origin?.catalogId === entry.catalogId),
  }))
}

/** Follows an official pack: it is added at the end, kept equal to the official one, without records. The name gets （2）… when taken. */
export function followOfficialPack(library: Library, catalogId: string, ids: NewPackIds, now = new Date()): Library {
  return followPack(library, officialPacks(), catalogId, ids, now)
}

/** A switch of the interests screen: whether the library is to follow that official pack. */
export type CatalogChoice = { catalogId: string; follow: boolean }

/**
 * Makes the library follow exactly the chosen official packs among the choices: a pack switched on that is not followed
 * is followed (at the end, in the order of the choices), and a followed pack switched off is unfollowed, which deletes it
 * with its lists and records. `ids` gives the ids of a pack to follow.
 */
export function applyCatalogChoices(library: Library, choices: CatalogChoice[], ids: (entry: OfficialPack) => NewPackIds, now = new Date()): Library {
  let next = library
  for (const { catalogId, follow } of choices) {
    const followed = next.packs.find(pack => isFollowed(pack) && pack.origin?.catalogId === catalogId)
    if (follow && !followed) {
      const entry = officialPacks().find(item => item.catalogId === catalogId)
      next = followOfficialPack(next, catalogId, entry ? ids(entry) : { pack: '', lists: [] }, now)
    } else if (!follow && followed) {
      next = deletePack(next, followed.id)
    }
  }
  return next
}

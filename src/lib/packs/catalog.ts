import type { NewPackIds } from '../packFile'
import { followOfficial, followPack, type OfficialPack } from '../followedPacks'
import type { Library } from '../wordPacks'
import { officialLibrary } from './'

// The official packs are the packs an account can follow. This file holds all of them with their words, about 1 MB:
// it is for the server (the Route Handlers, and pages rendered there). The browser reads officialCatalog.ts, which
// loads the words of one pack at a time.
export type { OfficialPack }

// Built once. Callers only read it.
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

/** Follows an official pack: it is added at the end, kept equal to the official one, without records. The name gets （2）… when taken. */
export function followOfficialPack(library: Library, catalogId: string, ids: NewPackIds, now = new Date()): Library {
  return followPack(library, officialPacks(), catalogId, ids, now)
}

import { AppError } from './appError'
import { isFollowed } from './followedPacks'
import { MAX_LISTS, ownListCount } from './listOverview'
import { MAX_LEVEL, MAX_LEVELS, MAX_SAVED_LEVELS, normalizeLabels, validateList, type SavedWordList } from './wordLists'
import { levelPath, nameKey, pathsOverlap, repairLibrary, validateLibrary, type Library, type WordPack } from './wordPacks'

export { levelPath, pathsOverlap }

/** The pack with the given id when it holds exactly one list: moving or deleting that list deletes the pack. */
export function loneListPack(library: Library, packId: string | undefined): WordPack | undefined {
  return packId !== undefined && library.lists.filter(list => list.packId === packId).length === 1
    ? library.packs.find(pack => pack.id === packId) : undefined
}

/** The library with the lists in the saved shape: the screens' lists carry their pack's labels, which are not saved. */
export function storedLibrary({ packs, lists }: Library): Library {
  return { packs, lists: lists.map(({ group: _group, category: _category, tags: _tags, ...rest }) => rest) }
}

export type PackInput = { name: string; description?: string; category?: string; tags?: string[] }

const invalid = () => new Error('Invalid packs')

export function packFieldsOf(pack?: WordPack): PackInput {
  return { name: pack?.name ?? '', description: pack?.description ?? '', category: pack?.category ?? '', tags: pack?.tags ?? [] }
}

// Another tab may add or delete a list of the pack while it is edited: the order keeps the ids that still exist, then the new lists.
export function reconcileOrder(order: string[], lists: SavedWordList[]): string[] {
  const ids = new Set(lists.map(list => list.id))
  const kept = order.filter(id => ids.has(id))
  return [...kept, ...lists.map(list => list.id).filter(id => !kept.includes(id))]
}

/**
 * The lists matching `query` by their own name or their pack's name, without case. A list's pack is named in `inPack`
 * when the pack holds other lists of `lists` too, since choosing the list takes it out of that pack.
 */
export function packListChoices(lists: SavedWordList[], packs: WordPack[], query: string): { list: SavedWordList; inPack?: string }[] {
  const packName = new Map(packs.map(pack => [pack.id, pack.name]))
  const sizes = new Map<string, number>()
  for (const list of lists) sizes.set(list.packId ?? '', (sizes.get(list.packId ?? '') ?? 0) + 1)
  const needle = query.trim().toLocaleLowerCase()
  return lists
    .filter(list => !needle || list.name.toLocaleLowerCase().includes(needle) || packName.get(list.packId ?? '')?.toLocaleLowerCase().includes(needle))
    .map(list => ({ list, inPack: (sizes.get(list.packId ?? '') ?? 0) >= 2 ? packName.get(list.packId ?? '') : undefined }))
}

// A pack as saved from the fields of a screen: trimmed, and without a description or labels when they are empty.
function packFields(library: Library, fields: PackInput, selfId?: string) {
  const name = fields.name.trim()
  if (!name) throw new AppError('packNameRequired')
  if (library.packs.some(pack => pack.id !== selfId && nameKey(pack.name) === nameKey(name))) throw new AppError('packNameDuplicate')
  const description = fields.description?.trim()
  return { name, ...(description ? { description } : {}), ...normalizeLabels(fields) }
}

// Levels as normalizeGroup keeps them: trimmed, without empty ones, and left out when none is left. More than a file of
// an older app could hold, or one longer than MAX_LEVEL, is refused.
export function trimLevels(levels: string[] | undefined) {
  const kept = (levels ?? []).map(level => level.trim()).filter(Boolean)
  if (kept.length > MAX_SAVED_LEVELS || kept.some(level => level.length > MAX_LEVEL)) throw invalid()
  return kept.length ? { levels: kept } : {}
}

// Levels as a save keeps them (trimLevels): one at most (tooManyLevels).
export function tidyLevels(levels: string[] | undefined) {
  if ((levels ?? []).filter(level => level.trim()).length > MAX_LEVELS) throw new AppError('tooManyLevels')
  return trimLevels(levels)
}

const requirePack = (library: Library, packId: string) => {
  const pack = library.packs.find(item => item.id === packId)
  if (!pack) throw new AppError('packDeleted')
  return pack
}

// An official pack that is followed is the catalog's to change: edits to it, or to a list in it, are refused.
const refuseFollowed = (library: Library, packId: string | undefined) => {
  const pack = packId === undefined ? undefined : library.packs.find(item => item.id === packId)
  if (pack && isFollowed(pack)) throw new AppError('packFollowed')
}

// Every function ends here: the result is repaired, then refused if it is still not a library that can be saved.
export function settle(library: Library) {
  const result = repairLibrary(library)
  validateLibrary(result)
  return result
}

/**
 * Makes a pack of lists already saved, which move into it in the order given (the pack is added last). A pack the lists
 * leave keeps its other lists; one left with none is dropped. Lists of a followed pack cannot be moved, and lists that
 * would share a name or levels in the new pack are refused as saving a list into it would be.
 */
export function createPackFromLists(library: Library, fields: PackInput, listIds: string[], packId: string, now = new Date()): Library {
  const saved = packFields(library, fields)
  const ids = [...new Set(listIds)]
  if (!ids.length) throw new AppError('packListsRequired')
  const moved = ids.map(id => {
    const list = library.lists.find(item => item.id === id)
    if (!list) throw new AppError('listDeleted')
    refuseFollowed(library, list.packId)
    return list
  })
  moved.forEach((list, index) => {
    const before = moved.slice(0, index)
    validateList(list, before)
    if (before.some(other => pathsOverlap(levelPath(other), levelPath(list)))) throw new AppError('levelsConflict')
  })
  const pack: WordPack = { id: packId, ...saved, createdAt: now.toISOString() }
  return settle({
    packs: [...library.packs, pack],
    lists: [...library.lists.filter(list => !ids.includes(list.id)), ...moved.map(list => ({ ...list, packId }))],
  })
}

export function updatePack(library: Library, packId: string, fields: PackInput): Library {
  requirePack(library, packId)
  refuseFollowed(library, packId)
  const saved = packFields(library, fields, packId)
  const packs = library.packs.map(pack => {
    if (pack.id !== packId) return pack
    const { name: _name, description: _description, category: _category, tags: _tags, ...rest } = pack
    return { ...rest, ...saved }
  })
  return settle({ packs, lists: library.lists })
}

/**
 * `listIds` is the pack's lists in the new order. It may be stale (another tab added or deleted a list):
 * ids the pack does not hold are dropped, and lists of the pack not given keep their saved order after the given ones.
 */
export function reorderPackLists(library: Library, packId: string, listIds: string[]): Library {
  requirePack(library, packId)
  refuseFollowed(library, packId)
  const mine = library.lists.filter(list => list.packId === packId)
  const byId = new Map(mine.map(list => [list.id, list]))
  const given = [...new Set(listIds)].filter(id => byId.has(id))
  const order = [...given, ...mine.map(list => list.id).filter(id => !given.includes(id))]
  let next = 0
  return settle({ packs: library.packs, lists: library.lists.map(list => list.packId === packId ? byId.get(order[next++])! : list) })
}

export function deletePack(library: Library, packId: string): Library {
  requirePack(library, packId)
  return settle({ packs: library.packs.filter(pack => pack.id !== packId), lists: library.lists.filter(list => list.packId !== packId) })
}

/** Creates or edits a list in a pack; with no pack (`packId` null) the list gets a pack of its own, named after it. */
export function saveListInPack(library: Library,
  list: { id: string; name: string; words: SavedWordList['words']; levels?: string[]; writing?: SavedWordList['writing']; createdAt: string },
  packId: string | null, editing: boolean): Library {
  if (packId !== null) requirePack(library, packId)
  const existing = library.lists.find(item => item.id === list.id)
  if (editing && !existing) throw new AppError('listDeleted')
  // Neither the pack the list is saved to nor, when it is moved, the pack it leaves may be followed.
  refuseFollowed(library, packId ?? undefined)
  if (editing) refuseFollowed(library, existing!.packId)
  if (!editing && ownListCount(library) >= MAX_LISTS) throw new AppError('listLimit', { max: MAX_LISTS })
  const target = packId ?? newPackId(library, list.id)
  validateList({ ...list, records: [] }, packId === null ? [] : library.lists.filter(item => item.packId === packId && item.id !== list.id))
  const { levels, createdAt, ...fields } = list
  const { levels: _levels, writing: _writing, ...kept } = editing ? existing! : { levels: undefined, writing: undefined }
  const saved: SavedWordList = { records: [], ...kept, ...fields, createdAt: existing?.createdAt ?? createdAt, name: list.name.trim(), ...tidyLevels(levels), packId: target }
  const packs = packId === null ? [...library.packs, { id: target, name: saved.name, createdAt: saved.createdAt }] : library.packs
  const others = library.lists.filter(item => item.id !== list.id)
  if (packId !== null && others.some(item => item.packId === target && pathsOverlap(levelPath(item), levelPath(saved)))) throw new AppError('levelsConflict')
  if (!editing) return settle({ packs, lists: [...others, saved] })
  // Staying in the pack keeps the place; moving puts the list right after the last list of the pack it joins.
  if (existing!.packId === target) return settle({ packs, lists: library.lists.map(item => item.id === list.id ? saved : item) })
  const end = others.map(item => item.packId).lastIndexOf(target)
  return settle({ packs, lists: [...others.slice(0, end + 1), saved, ...others.slice(end + 1)] })
}

function newPackId(library: Library, listId: string) {
  const taken = new Set(library.packs.map(pack => pack.id))
  let id = `pack-${listId}`
  for (let n = 2; taken.has(id); n++) id = `pack-${listId}-${n}`
  return id
}

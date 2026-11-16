import { encodePackFile } from '../core/packFile'
import { followed } from '../core/packs/catalog'
import { decodeDocument } from '../core/workspaceDocument'

// A pack is shared by link: /api/shares is the owner's (list, share or copy again, stop sharing) and /api/shared is for
// anyone with the link (src/server/shared.ts). A link keeps a copy of the pack as a file, made when it is shared.

/** A saved row of typle_workspaces, its JSON columns as text. packs is null for data saved before packs. */
export type SavedRow = { lists: string, packs: string | null, devices: string }

/**
 * The file of the pack packId in the saved row, or null when the pack is not there. The row is read as the app reads
 * the account's workspace (src/lib/storage/cloud.ts): decodeDocument, then the followed official packs get their words
 * from the catalog. An account that has saved nothing (no row) has no pack.
 */
export function sharedPackFile(saved: SavedRow | null, packId: string): string | null {
  if (!saved) return null
  const document = decodeDocument({
    lists: JSON.parse(saved.lists),
    packs: saved.packs === null ? null : JSON.parse(saved.packs),
    devices: JSON.parse(saved.devices),
  })
  const library = followed(document)
  if (!library.packs.some(pack => pack.id === packId)) return null
  return encodePackFile(library, packId)
}

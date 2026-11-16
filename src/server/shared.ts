import type { Pool } from 'pg'
import { decodePackFile, type PackFile } from '../core/packFile'
import { reportFailure } from './report'
import { notForSearch, refuse } from './response'

// /api/shared answers the pack a link shares, as the file it was copied into. Anyone with the link may read it, so it
// needs no cookie, but it is not kept, so that a link that is stopped is gone at once.

/** Whether id is a UUID as the links are written: 8-4-4-4-12 hexadecimal digits. */
const isLinkId = (id: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)

/**
 * The text of a stored shared pack as the Go backend wrote it (PackFile.Encode): read with decodePackFile, then written
 * with the keys in the file's order, two-space indents and a newline at the end. Like Go's omitempty, an empty
 * description, category, tags or levels is left out. A pack that cannot be read throws decodePackFile's error.
 */
export function encodeSharedPack(text: string): string {
  const file: PackFile = decodePackFile(text)
  const { name, description, category, tags } = file.pack
  return JSON.stringify({
    ...file,
    pack: { name, ...(description ? { description } : {}), ...(category ? { category } : {}), ...(tags?.length ? { tags } : {}) },
    lists: file.lists.map(({ levels, ...list }) => {
      const { name: listName, writing, words } = list
      return { name: listName, ...(levels?.length ? { levels } : {}), ...(writing ? { writing } : {}), words }
    }),
  }, null, 2) + '\n'
}

/** The file of the pack the link id shares, or null when there is no such link or it is hidden. */
export async function readSharedPack(db: Pool, id: string): Promise<string | null> {
  if (!isLinkId(id)) return null
  const { rows } = await db.query<{ data: string }>(
    'SELECT data::text AS data FROM typle_shared_packs WHERE id = $1 AND hidden_at IS NULL', [id])
  return rows.length ? encodeSharedPack(rows[0].data) : null
}

/** GET /api/shared?id=: the shared pack's file, the same for every reader. Every answer is kept from search engines. */
export async function answerShared(request: Request, open: () => Pool): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? ''
  let file: string | null
  try {
    file = await readSharedPack(open(), id)
  } catch (error) {
    reportFailure(request, error, 'shared.read')
    return notForSearch(refuse(503, 'databaseUnavailable'))
  }
  if (file === null) return notForSearch(refuse(404, 'sharedPackNotFound'))
  return notForSearch(new Response(file, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  }))
}

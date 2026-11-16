import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { encodePackFile } from '../core/packFile'
import { followed } from '../core/packs/catalog'
import { decodeDocument } from '../core/workspaceDocument'
import { signedIn } from './account'
import { reportFailure } from './report'
import { fromAppOrOrigin, jsonContent } from './request'
import { refuse, reply } from './response'
import { readLoginSettings, type LoginSettings } from './settings'

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

/** The largest file a link keeps. */
const MAX_SHARED_PACK_BYTES = 1 << 20
/** The most a PUT body needs: a pack id, and room to spare. */
const MAX_SHARE_BODY_BYTES = 4096

/** A link as /api/shares answers it. */
type ShareRow = { id: string, pack_id: string, name: string, listed: boolean, hidden: boolean, updated_at: Date }
const shareJson = (row: ShareRow) => ({
  id: row.id, packId: row.pack_id, name: row.name, updatedAt: row.updated_at.toISOString(), listed: row.listed, hidden: row.hidden,
})

/** A refusal of the request that is answered with status and key, without anything to report. */
class Refused extends Error {
  constructor(readonly status: number, readonly key: string) {
    super(key)
  }
}

/** The owner's links, the most recently updated first. */
async function listShares(db: Pool, owner: string): Promise<ShareRow[]> {
  const { rows } = await db.query<ShareRow>(`SELECT id::text AS id, pack_id, COALESCE(data #>> '{pack,name}', '') AS name,
      listed_at IS NOT NULL AS listed, hidden_at IS NOT NULL AS hidden, updated_at
    FROM typle_shared_packs WHERE owner_id = $1 ORDER BY updated_at DESC, id`, [owner])
  return rows
}

/**
 * Shares the owner's pack packId as it is saved, or copies it again into its link. listed true lists it in the gallery
 * (keeping the time it was first listed), false takes it out, and undefined leaves the listing as it is; a hidden link
 * can still be copied again, but its listing cannot change.
 *
 * The owner's lock and the workspace row are held as the Go backend's saves hold them (store.PutShare and lockOwner), so
 * a save that removes the pack at the same moment either comes first (and the pack is not found) or deletes the link
 * once this is done.
 */
async function putShare(db: Pool, owner: string, packId: string, listed: boolean | undefined): Promise<ShareRow> {
  const connection = await db.connect()
  try {
    await connection.query('BEGIN')
    await connection.query(`SELECT pg_advisory_xact_lock(hashtext('typle_workspaces:' || $1))`, [owner])
    const { rows: saved } = await connection.query<SavedRow>(
      'SELECT lists::text AS lists, packs::text AS packs, devices::text AS devices FROM typle_workspaces WHERE owner_id = $1 FOR UPDATE', [owner])
    const file = sharedPackFile(saved[0] ?? null, packId)
    if (file === null) throw new Refused(404, 'packNotFound')
    if (Buffer.byteLength(file) > MAX_SHARED_PACK_BYTES) throw new Refused(400, 'invalidWorkspace')
    if (listed !== undefined) {
      const { rows } = await connection.query<{ hidden: boolean }>(`SELECT hidden_at IS NOT NULL AS hidden FROM typle_shared_packs
        WHERE owner_id = $1 AND pack_id = $2 FOR UPDATE`, [owner, packId])
      if (rows[0]?.hidden) throw new Refused(409, 'sharedPackHidden')
    }
    const { rows } = await connection.query<ShareRow>(`INSERT INTO typle_shared_packs (id, owner_id, pack_id, data, listed_at)
        VALUES ($1, $2, $3, $4::jsonb, CASE WHEN $5::boolean THEN now() END)
      ON CONFLICT (owner_id, pack_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now(),
        listed_at = CASE WHEN $5::boolean IS NULL THEN typle_shared_packs.listed_at
          WHEN $5::boolean THEN COALESCE(typle_shared_packs.listed_at, now()) END
      RETURNING id::text AS id, pack_id, COALESCE(data #>> '{pack,name}', '') AS name, listed_at IS NOT NULL AS listed,
        hidden_at IS NOT NULL AS hidden, updated_at`, [randomUUID(), owner, packId, file, listed ?? null])
    await connection.query('COMMIT')
    connection.release()
    return rows[0]
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {})
    connection.release(true)
    throw error
  }
}

/**
 * The body of PUT /api/shares: {"packId": "<a pack id>"} with, optionally, "listed": true or false, and no other member.
 * null for anything else ("listed": null too).
 */
async function readShareBody(request: Request): Promise<{ packId: string, listed: boolean | undefined } | null> {
  let body: ArrayBuffer
  try {
    body = await request.arrayBuffer()
  } catch {
    // A stream that breaks off is a body that cannot be read, as the Go backend answered it.
    return null
  }
  if (body.byteLength === 0 || body.byteLength > MAX_SHARE_BODY_BYTES) return null
  let fields: unknown
  try {
    fields = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return null
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null
  const { packId, listed, ...others } = fields as Record<string, unknown>
  if (Object.keys(others).length || typeof packId !== 'string' || !packId) return null
  if ('listed' in fields && typeof listed !== 'boolean') return null
  return { packId, listed: listed as boolean | undefined }
}

/** The answer of a write that changed nothing to show. */
const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })

/**
 * /api/shares: GET (and HEAD) lists the owner's links, PUT {"packId", "listed"?} shares a pack or copies it again, and
 * DELETE ?pack= stops sharing it. A write must come from the app, and every method needs the login.
 */
export async function answerShares(request: Request, open: () => Pool, settings: () => LoginSettings | null = readLoginSettings): Promise<Response> {
  const login = settings()
  if (!login) return refuse(503, 'authUnavailable')
  const write = request.method === 'PUT' || request.method === 'DELETE'
  if (write && (!fromAppOrOrigin(request, login.origin) || (request.method === 'PUT' && !jsonContent(request)))) {
    return refuse(403, 'forbiddenRequest')
  }
  let db: Pool
  try {
    db = open()
  } catch (error) {
    reportFailure(request, error, 'shares.open')
    return refuse(503, 'databaseUnavailable')
  }
  const account = await signedIn(request, db, login)
  if ('refusal' in account) return account.refusal
  const owner = account.user.sub

  if (request.method === 'PUT') {
    const body = await readShareBody(request)
    if (!body) return refuse(400, 'invalidWorkspace')
    try {
      return reply(200, shareJson(await putShare(db, owner, body.packId, body.listed)))
    } catch (error) {
      if (error instanceof Refused) return refuse(error.status, error.key)
      reportFailure(request, error, 'shares.write')
      return refuse(503, 'workspaceSaveFailed')
    }
  }
  if (request.method === 'DELETE') {
    const packId = new URL(request.url).searchParams.get('pack') ?? ''
    if (!packId) return refuse(400, 'invalidWorkspace')
    try {
      await db.query('DELETE FROM typle_shared_packs WHERE owner_id = $1 AND pack_id = $2', [owner, packId])
    } catch (error) {
      reportFailure(request, error, 'shares.write')
      return refuse(503, 'workspaceSaveFailed')
    }
    return noContent()
  }
  try {
    return reply(200, { shares: (await listShares(db, owner)).map(shareJson) })
  } catch (error) {
    reportFailure(request, error, 'shares.read')
    return refuse(503, 'databaseUnavailable')
  }
}

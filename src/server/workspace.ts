import type { Pool, PoolClient } from 'pg'
import { AppError } from '../core/appError'
import { DEFAULT_INTERESTS } from '../core/interests'
import { MAX_LEVEL, MAX_SAVED_LEVELS } from '../core/wordLists'
import { withoutFollowedWords } from '../core/followedPacks'
import { followedPackCount, MAX_FOLLOWED_PACKS, MAX_LISTS, ownListCount } from '../core/listOverview'
import { followed } from '../core/packs/catalog'
import { repairLibrary } from '../core/wordPacks'
import { decodeDocument, type WorkspaceChange } from '../core/workspaceDocument'
import { validateWorkspaceRequest } from '../core/workspaceRequest'
import { recordRows, syncRecords, withRecords } from './records'

// The account's workspace, /api/workspace: its lists, packs, devices and interests as saved in typle_workspaces, with
// the records of typle_records put back in their lists, and the revision a save must name.

/** A workspace as saved: the values of its jsonb columns (packs null when the lists were saved before packs, interests
 * null when none have been saved) and its revision. */
export type SavedWorkspace = { lists: unknown[], packs: unknown[] | null, devices: unknown[], interests: unknown[] | null, revision: number }

/**
 * The owner's saved workspace, or null when nothing has been saved. The row and its records are read in one statement,
 * so from one snapshot. The row is checked as the app reads it (decodeDocument, then the followed packs), so saved data
 * that cannot be read throws; but it is answered as saved, not as checked, as the Go backend answered it.
 */
export async function readSavedWorkspace(db: Pool | PoolClient, owner: string): Promise<SavedWorkspace | null> {
  const { rows } = await db.query<{ lists: string, packs: string | null, devices: string, interests: string | null, revision: number, records: string | null }>(
    `SELECT lists::text AS lists, packs::text AS packs, devices::text AS devices, interests::text AS interests, revision,
      CASE WHEN records_split THEN (SELECT COALESCE(jsonb_agg(jsonb_build_array(r.list_id, r.data) ORDER BY r.list_id, r.position), '[]'::jsonb)
        FROM typle_records r WHERE r.owner_id = typle_workspaces.owner_id)::text END AS records
    FROM typle_workspaces WHERE owner_id = $1`, [owner])
  if (!rows.length) return null
  const row = rows[0]
  let lists = JSON.parse(row.lists) as unknown[]
  if (row.records !== null) {
    const stored = new Map<string, unknown[]>()
    for (const [listId, record] of JSON.parse(row.records) as [string, unknown][]) {
      stored.set(listId, [...stored.get(listId) ?? [], record])
    }
    lists = withRecords(lists, stored)
  }
  const saved: SavedWorkspace = {
    lists,
    packs: row.packs === null ? null : JSON.parse(row.packs),
    devices: JSON.parse(row.devices),
    interests: row.interests === null ? null : JSON.parse(row.interests),
    revision: row.revision,
  }
  // Throws on saved data the app could not read either.
  followed(decodeDocument({ lists: saved.lists, packs: saved.packs, devices: saved.devices, interests: saved.interests ?? undefined }))
  return saved
}

/** The answer of GET and PUT /api/workspace for owner's saved workspace; revision 0 and no lists when there is none. */
export function workspaceAnswer(saved: SavedWorkspace | null, owner: string) {
  return {
    lists: saved?.lists ?? [],
    packs: saved?.packs ?? null,
    devices: saved?.devices ?? [],
    interests: saved?.interests ?? [...DEFAULT_INTERESTS],
    revision: saved?.revision ?? 0,
    accountId: owner,
  }
}

/**
 * Whether value holds a string (or a key) that PostgreSQL's jsonb cannot keep: one with U+0000 or a lone surrogate.
 * The Go backend refused such a save as invalid rather than failing to write it.
 */
function unstorable(value: unknown): boolean {
  if (typeof value === 'string') return /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value)
  if (Array.isArray(value)) return value.some(unstorable)
  if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => unstorable(key) || unstorable(item))
  return false
}

/**
 * The revision and change of a PUT /api/workspace body, read as the app's validateWorkspaceRequest reads it, and
 * answered as the Go backend answered it (the owner's decision before moving /api/workspace): any refusal but
 * levelsConflict is invalidWorkspace; lists, packs or devices sent as null are refused, and so is a string jsonb cannot
 * keep; interests sent as null are none; and lists of several levels sent with their packs, by an app before v0.97.0,
 * are taken, to be joined into one as the saved data is repaired.
 */
export function readWorkspaceChange(fields: Record<string, unknown>): { revision: number, change: WorkspaceChange } | { refusal: 'invalidWorkspace' | 'levelsConflict' } {
  const invalid = { refusal: 'invalidWorkspace' as const }
  if (fields.lists === null || fields.packs === null || fields.devices === null) return invalid
  if (unstorable(fields.lists) || unstorable(fields.packs) || unstorable(fields.devices) || unstorable(fields.interests)) return invalid
  const { accountId: _accountId, interests, ...rest } = fields
  // A list of several levels is out of reach of no other list; the levels are joined when the change is applied.
  const severalLevels = new Map<unknown, unknown>()
  const lists = Array.isArray(rest.lists) && rest.packs !== undefined
    ? rest.lists.map((item, index) => {
      const list = item as { levels?: unknown }
      // Levels past the saved limits are left as they are, for validateWorkspaceRequest to refuse.
      if (!Array.isArray(list?.levels) || list.levels.length <= 1 || list.levels.length > MAX_SAVED_LEVELS ||
        list.levels.some(level => typeof level !== 'string' || level.length > MAX_LEVEL)) return item
      severalLevels.set(index, list.levels)
      return { ...list, levels: [`\u0000several-${index}`] }
    })
    : rest.lists
  let checked: WorkspaceChange & { revision: number }
  try {
    checked = validateWorkspaceRequest({ ...rest, ...(lists === undefined ? {} : { lists }), ...(interests === undefined || interests === null ? {} : { interests }) })
  } catch (error) {
    return error instanceof AppError && error.key === 'levelsConflict' ? { refusal: 'levelsConflict' } : invalid
  }
  const { revision, ...change } = checked
  if (change.lists && severalLevels.size) {
    change.lists = change.lists.map((list, index) => severalLevels.has(index) ? { ...list, levels: severalLevels.get(index) as string[] } : list)
  }
  if (interests === null) change.interests = []
  return { revision, change }
}

/** A save named a revision the workspace has moved on from; the app reads it again (409). */
export class Conflict extends Error {
  constructor() {
    super('conflict')
  }
}

/** A refusal answered with its key: invalidWorkspace, listLimit or followLimit. */
const refusal = (key: 'invalidWorkspace' | 'listLimit' | 'followLimit') => new AppError(key)

/**
 * The parts a save writes, as the Go backend's encodeChange makes them. The lists are repaired and their followed packs
 * follow the catalog, as the app reads saved data (so what is saved reads back the same); they are then saved without
 * the followed packs' words and without their records, which go to typle_records.
 */
function encodeChange(change: WorkspaceChange) {
  const { devices, interests } = change
  if (!change.lists) return { devices, interests, library: undefined }
  const repaired = followed(repairLibrary({ lists: change.lists, packs: change.packs ?? [] }))
  const rows = recordRows(repaired.lists as never)
  const slim = withoutFollowedWords(repaired)
  // A change the app could not read back is never written.
  try {
    followed(decodeDocument({ lists: slim.lists, packs: slim.packs, devices: devices ?? [], interests }))
  } catch {
    throw refusal('invalidWorkspace')
  }
  return {
    devices,
    interests,
    library: {
      lists: slim.lists.map(list => ({ ...list, records: [] })),
      packs: slim.packs,
      rows,
      own: ownListCount(repaired),
      followed: followedPackCount(repaired.packs),
    },
  }
}

const json = (value: unknown) => value === undefined ? null : JSON.stringify(value)

/**
 * Saves change over the owner's workspace at revision, as the Go backend's WriteRevision does: revision 0 creates the
 * row, any other replaces what is saved only if it is still that revision (else Conflict). Parts not sent stay as they
 * are. Lists saved bring their records (typle_records becomes exactly theirs); packs saved delete the links to packs no
 * longer among them. More lists or followed packs than allowed are refused, unless the saved workspace already had more
 * and the save does not raise the number. Returns the workspace as now saved.
 */
export async function writeWorkspace(db: Pool, owner: string, revision: number, change: WorkspaceChange): Promise<SavedWorkspace> {
  const { devices, interests, library } = encodeChange(change)
  const connection = await db.connect()
  try {
    await connection.query('BEGIN')
    if (revision === 0) {
      if (library && library.own > MAX_LISTS) throw refusal('listLimit')
      if (library && library.followed > MAX_FOLLOWED_PACKS) throw refusal('followLimit')
      // As a share of the initial packs is made under the owner's lock (src/server/shares.ts), so that a first save sees it.
      await connection.query(`SELECT pg_advisory_xact_lock(hashtext('typle_workspaces:' || $1))`, [owner])
      const { rows } = await connection.query(`INSERT INTO typle_workspaces (owner_id, lists, packs, devices, interests, records_split)
        VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, true) ON CONFLICT (owner_id) DO NOTHING RETURNING revision`,
      [owner, json(library?.lists ?? []), json(library?.packs), json(devices ?? []), json(interests)])
      if (!rows.length) throw new Conflict()
      await connection.query('DELETE FROM typle_records WHERE owner_id = $1', [owner])
    } else {
      // The saved lists and followed packs, counted as ownListCount and followedPackCount count them.
      const { rows } = await connection.query<{ revision: number, own: string, followed: string }>(`WITH followed AS (
          SELECT p->>'id' AS id FROM typle_workspaces, jsonb_array_elements(COALESCE(packs, '[]'::jsonb)) AS p
          WHERE owner_id = $1 AND p->'origin'->>'followed' = 'true')
        SELECT revision,
          (SELECT count(*) FROM jsonb_array_elements(lists) AS l
            WHERE l->>'packId' IS NULL OR l->>'packId' NOT IN (SELECT id FROM followed)) AS own,
          (SELECT count(*) FROM followed) AS followed
        FROM typle_workspaces WHERE owner_id = $1`, [owner])
      if (!rows.length || rows[0].revision !== revision) throw new Conflict()
      if (library && library.own > MAX_LISTS && library.own > Number(rows[0].own)) throw refusal('listLimit')
      if (library && library.followed > MAX_FOLLOWED_PACKS && library.followed > Number(rows[0].followed)) throw refusal('followLimit')
      // Matching the revision in the UPDATE itself makes the comparison and the write one atomic operation.
      const updated = await connection.query(`UPDATE typle_workspaces SET lists = COALESCE($3::jsonb, lists),
          packs = COALESCE($4::jsonb, packs), devices = COALESCE($5::jsonb, devices), interests = COALESCE($6::jsonb, interests),
          records_split = records_split OR $3::jsonb IS NOT NULL, revision = revision + 1, updated_at = now()
        WHERE owner_id = $1 AND revision = $2 RETURNING revision`,
      [owner, revision, json(library?.lists), json(library?.packs), json(devices), json(interests)])
      if (!updated.rows.length) throw new Conflict()
    }
    if (library) await syncRecords(connection, owner, library.rows)
    const saved = await readSavedWorkspace(connection, owner)
    if (library) {
      await connection.query('DELETE FROM typle_shared_packs WHERE owner_id = $1 AND NOT (pack_id = ANY($2::text[]))',
        [owner, library.packs.map(pack => pack.id)])
    }
    await connection.query('COMMIT')
    connection.release()
    return saved!
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {})
    connection.release(true)
    throw error
  }
}

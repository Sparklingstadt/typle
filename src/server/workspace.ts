import type { Pool, PoolClient } from 'pg'
import { DEFAULT_INTERESTS } from '../core/interests'
import { followed } from '../core/packs/catalog'
import { decodeDocument } from '../core/workspaceDocument'
import { withRecords } from './records'

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

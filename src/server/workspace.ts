import type { Pool, PoolClient } from 'pg'
import { AppError } from '../lib/appError'
import { DEFAULT_INTERESTS } from '../lib/interests'
import { MAX_LEVEL, MAX_SAVED_LEVELS } from '../lib/wordLists'
import { withoutFollowedWords } from '../lib/followedPacks'
import { followedPackCount, MAX_FOLLOWED_PACKS, MAX_LISTS, ownListCount } from '../lib/listOverview'
import { followed } from '../lib/packs/catalog'
import { addRecord, deleteRecord, type RecordInput } from '../lib/records'
import { repairLibrary } from '../lib/wordPacks'
import { decodeDocument, type WorkspaceChange, type WorkspaceDocument } from '../lib/workspaceDocument'
import { validateWorkspaceRequest } from '../lib/workspaceRequest'
import { signedIn } from './account'
import { measureSave } from './metrics'
import { recordRows, syncRecords, withRecords } from './records'
import { reportFailure } from './report'
import { sameOrigin, jsonContent } from './request'
import { refuse, reply } from './response'
import { readLoginSettings, type LoginSettings } from './settings'

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
 * The parts a save writes, as the Go backend's encodeChange made them. The lists are repaired and their followed packs
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
      // The bytes of the lists (with their records) and packs as saved, which a change may not grow past MAX_LISTS_BYTES.
      size: Buffer.byteLength(JSON.stringify(slim.lists)) + Buffer.byteLength(JSON.stringify(slim.packs)),
    },
  }
}

/** The most bytes the lists and packs may grow to by a change of a record (the Go backend's MaxListsBytes). */
const MAX_LISTS_BYTES = 896 << 10

/**
 * Changes the owner's workspace and saves it, as the Go backend's Modify did for adding and deleting records: in one
 * transaction that holds the row, so a change is never refused for a revision another save moved on; the save from
 * before it is the one told to reload (409). change gets the workspace as the app reads it, and says whether it changed
 * anything; nothing changed is nothing written. A change is saved as a save of the lists and packs is (encodeChange),
 * with the revision one up, and is refused when it makes them larger than MAX_LISTS_BYTES. A refusal change throws is
 * thrown, with nothing written. Returns change's result and the workspace as saved afterwards, null when there is none.
 */
export async function modifyWorkspace<T>(db: Pool, owner: string,
  change: (document: WorkspaceDocument) => { document: WorkspaceDocument, changed: boolean, result: T }): Promise<{ result: T, saved: SavedWorkspace | null }> {
  const connection = await db.connect()
  try {
    await connection.query('BEGIN')
    const { rows } = await connection.query<{ lists: string, packs: string | null, devices: string, split: boolean }>(
      'SELECT lists::text AS lists, packs::text AS packs, devices::text AS devices, records_split AS split FROM typle_workspaces WHERE owner_id = $1 FOR UPDATE',
      [owner])
    let document: WorkspaceDocument = { lists: [], packs: [], devices: [], interests: [] }
    if (rows.length) {
      let lists = JSON.parse(rows[0].lists) as unknown[]
      if (rows[0].split) {
        const stored = await connection.query<{ list_id: string, data: string }>(
          'SELECT list_id, data::text AS data FROM typle_records WHERE owner_id = $1 ORDER BY list_id, position', [owner])
        const records = new Map<string, unknown[]>()
        for (const row of stored.rows) records.set(row.list_id, [...records.get(row.list_id) ?? [], JSON.parse(row.data)])
        lists = withRecords(lists, records)
      }
      document = followed(decodeDocument({ lists, packs: rows[0].packs === null ? null : JSON.parse(rows[0].packs), devices: JSON.parse(rows[0].devices) }))
    }
    const before = encodeChange({ lists: document.lists, packs: document.packs }).library!.size
    const { document: next, changed, result } = change(document)
    if (changed) {
      if (!rows.length) throw new Error(`no workspace of ${owner} to change`)
      const { library } = encodeChange({ lists: next.lists, packs: next.packs, devices: next.devices })
      if (library!.size > MAX_LISTS_BYTES && library!.size > before) throw new AppError('workspaceTooLarge')
      await connection.query(`UPDATE typle_workspaces SET lists = $2::jsonb, packs = $3::jsonb, devices = $4::jsonb,
          records_split = true, revision = revision + 1, updated_at = now() WHERE owner_id = $1`,
      [owner, JSON.stringify(library!.lists), JSON.stringify(library!.packs), JSON.stringify(next.devices)])
      await syncRecords(connection, owner, library!.rows)
    }
    const saved = await readSavedWorkspace(connection, owner)
    await connection.query('COMMIT')
    connection.release()
    return { result, saved }
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {})
    connection.release(true)
    throw error
  }
}

const json = (value: unknown) => value === undefined ? null : JSON.stringify(value)

/**
 * Saves change over the owner's workspace at revision, as the Go backend's WriteRevision did: revision 0 creates the
 * row, any other replaces what is saved only if it is still that revision (else Conflict). Parts not sent stay as they
 * are. Lists saved bring their records (typle_records becomes exactly theirs). More lists or followed packs than allowed are refused, unless the saved workspace already had more
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
      // Two first saves of the same owner wait here for each other.
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
    await connection.query('COMMIT')
    connection.release()
    return saved!
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {})
    connection.release(true)
    throw error
  }
}

/** The largest body a save may send. */
const MAX_BODY_BYTES = 1 << 20

/** GET /api/workspace: the owner's workspace as saved. */
async function readWorkspaceAnswer(request: Request, db: Pool, login: LoginSettings): Promise<Response> {
  const account = await signedIn(request, db, login)
  if ('refusal' in account) return account.refusal
  try {
    return reply(200, workspaceAnswer(await readSavedWorkspace(db, account.user.sub), account.user.sub))
  } catch (error) {
    reportFailure(request, error, 'workspace.read')
    return refuse(503, 'databaseUnavailable')
  }
}

/**
 * The owner and body of a request that saves, checked as the Go backend's saveRequest checked it (after the Origin and
 * Content-Type): the login, then the body (none is emptyRequest, past MAX_BODY_BYTES workspaceTooLarge, not a JSON
 * object invalid, one that cannot be read workspaceSaveFailed, reported as operation), then its accountId, which must be
 * the login's (loginAccountChanged), so a screen that signed in as someone else is told so first.
 */
async function readSaveRequest(request: Request, db: Pool, login: LoginSettings, operation: string, invalid: string):
  Promise<{ owner: string, fields: Record<string, unknown> } | { refusal: Response }> {
  const account = await signedIn(request, db, login)
  if ('refusal' in account) return account
  const owner = account.user.sub
  let body: ArrayBuffer
  try {
    body = await request.arrayBuffer()
  } catch (error) {
    reportFailure(request, error, operation)
    return { refusal: refuse(503, 'workspaceSaveFailed') }
  }
  if (body.byteLength === 0) return { refusal: refuse(400, 'emptyRequest') }
  if (body.byteLength > MAX_BODY_BYTES) return { refusal: refuse(413, 'workspaceTooLarge') }
  let fields: unknown
  try {
    fields = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return { refusal: refuse(400, invalid) }
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { refusal: refuse(400, invalid) }
  if ((fields as { accountId?: unknown }).accountId !== owner) return { refusal: refuse(401, 'loginAccountChanged') }
  return { owner, fields: fields as Record<string, unknown> }
}

/** PUT /api/workspace: checked as the Go backend's saveRequest and saveWorkspace checked it, in that order. */
async function saveWorkspaceAnswer(request: Request, db: Pool, login: LoginSettings): Promise<Response> {
  const save = await readSaveRequest(request, db, login, 'workspace.write', 'invalidWorkspace')
  if ('refusal' in save) return save.refusal
  const { owner, fields } = save
  const read = readWorkspaceChange(fields)
  if ('refusal' in read) return refuse(400, read.refusal)
  try {
    return reply(200, workspaceAnswer(await writeWorkspace(db, owner, read.revision, read.change), owner))
  } catch (error) {
    if (error instanceof Conflict) return refuse(409, 'conflict')
    if (error instanceof AppError && ['listLimit', 'followLimit', 'invalidWorkspace'].includes(error.key)) return refuse(400, error.key)
    reportFailure(request, error, 'workspace.write')
    return refuse(503, 'workspaceSaveFailed')
  }
}

/**
 * /api/workspace: GET (and HEAD) reads the owner's workspace, PUT saves a change of it by revision. A save must come
 * from the app's own page; both need the login. Saves are measured when env turns it on (src/server/metrics.ts).
 */
export async function answerWorkspace(request: Request, open: () => Pool, settings: () => LoginSettings | null = readLoginSettings,
  env: Record<string, string | undefined> = process.env): Promise<Response> {
  const login = settings()
  if (!login) return refuse(503, 'authUnavailable')
  if (request.method === 'PUT' && (!sameOrigin(request, login.origin) || !jsonContent(request))) return refuse(403, 'forbiddenRequest')
  let db: Pool
  try {
    db = open()
  } catch (error) {
    reportFailure(request, error, 'workspace.open')
    return refuse(503, 'databaseUnavailable')
  }
  if (request.method !== 'PUT') return readWorkspaceAnswer(request, db, login)
  return measureSave(request, 'workspace.write', () => db, () => saveWorkspaceAnswer(request, db, login), env)
}

/** The fields a record of POST /api/workspace/records may have: the Go backend's RecordInput. */
const RECORD_FIELDS = new Set(['id', 'time', 'date', 'mistakes', 'accuracy', 'wordCount', 'deviceId', 'device', 'mode', 'missed'])

/**
 * The list and record of a POST /api/workspace/records body: exactly accountId, listId (a string other than "") and
 * record, one object of RECORD_FIELDS with its id (a string). null when it is not, which is invalidRecord. As the Go
 * backend read them, wordCount, device and deviceId sent as null are left out. The record's values are checked when it
 * is added (addRecord).
 */
export function readRecordAdd(fields: Record<string, unknown>): { listId: string, input: RecordInput } | null {
  const { listId, record } = fields
  if (Object.keys(fields).length !== 3 || typeof listId !== 'string' || !listId) return null
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const input = { ...record as Record<string, unknown> }
  if (Object.keys(input).some(key => !RECORD_FIELDS.has(key)) || typeof input.id !== 'string') return null
  for (const name of ['wordCount', 'device', 'deviceId']) if (input[name] === null) delete input[name]
  return { listId, input: input as unknown as RecordInput }
}

/** The list and record of a DELETE /api/workspace/records body: exactly accountId, listId and recordId, both strings other than "". */
export function readRecordDelete(fields: Record<string, unknown>): { listId: string, recordId: string } | null {
  const { listId, recordId } = fields
  if (Object.keys(fields).length !== 3 || typeof listId !== 'string' || !listId || typeof recordId !== 'string' || !recordId) return null
  return { listId, recordId }
}

/**
 * A change of a record answered as the Go backend answered it: 404 recordListDeleted for a list that is gone, 413 for a
 * workspace that would be too large, 400 and the key for any other refusal, and 503 workspaceSaveFailed for the
 * server's failure, reported as operation.
 */
function recordRefusal(request: Request, error: unknown, operation: string): Response {
  if (error instanceof AppError && error.key === 'recordListDeleted') return refuse(404, 'recordListDeleted')
  if (error instanceof AppError && error.key === 'workspaceTooLarge') return refuse(413, 'workspaceTooLarge')
  if (error instanceof AppError) return refuse(400, error.key)
  reportFailure(request, error, operation)
  return refuse(503, 'workspaceSaveFailed')
}

/**
 * POST and DELETE /api/workspace/records: one practice record of the account's workspace at a time. Neither names a
 * revision: a record is saved or deleted however the lists were changed meanwhile, and a request sent again does the
 * same. POST {accountId, listId, record} adds the record, 201 when it is new and 200 when the list already had it, and
 * answers the workspace as now saved with the record; DELETE {accountId, listId, recordId} deletes it, 200 also when it,
 * or its list, is already gone, and answers the workspace as now saved.
 */
async function changeRecordAnswer(request: Request, db: Pool, login: LoginSettings): Promise<Response> {
  const adding = request.method === 'POST'
  const operation = adding ? 'record.add' : 'record.delete'
  const save = await readSaveRequest(request, db, login, operation, 'invalidRecord')
  if ('refusal' in save) return save.refusal
  const { owner, fields } = save
  let outcome: { result: { record: unknown, added: boolean } | null, saved: SavedWorkspace | null }
  try {
    if (adding) {
      const read = readRecordAdd(fields)
      if (!read) return refuse(400, 'invalidRecord')
      outcome = await modifyWorkspace(db, owner, document => {
        const { document: next, record, added } = addRecord(document, read.listId, read.input)
        return { document: next, changed: added, result: { record, added } }
      })
    } else {
      const read = readRecordDelete(fields)
      if (!read) return refuse(400, 'invalidRecord')
      outcome = await modifyWorkspace(db, owner, document => {
        const { document: next, deleted } = deleteRecord(document, read.listId, read.recordId)
        return { document: next, changed: deleted, result: null }
      })
    }
  } catch (error) {
    return recordRefusal(request, error, operation)
  }
  // The Go backend read the workspace again after a change, and failed when there was none.
  if (!outcome.saved) return recordRefusal(request, new Error('workspace missing after a record was changed'), operation)
  const answer = workspaceAnswer(outcome.saved, owner)
  if (!adding) return reply(200, answer)
  return reply(outcome.result!.added ? 201 : 200, { ...answer, record: outcome.result!.record })
}

/** /api/workspace/records, as answerWorkspace answers /api/workspace: POST adds a record, DELETE deletes one. */
export async function answerRecords(request: Request, open: () => Pool, settings: () => LoginSettings | null = readLoginSettings,
  env: Record<string, string | undefined> = process.env): Promise<Response> {
  const login = settings()
  if (!login) return refuse(503, 'authUnavailable')
  if (!sameOrigin(request, login.origin) || !jsonContent(request)) return refuse(403, 'forbiddenRequest')
  let db: Pool
  try {
    db = open()
  } catch (error) {
    reportFailure(request, error, 'workspace.open')
    return refuse(503, 'databaseUnavailable')
  }
  return measureSave(request, request.method === 'POST' ? 'record.add' : 'record.delete', () => db, () => changeRecordAnswer(request, db, login), env)
}

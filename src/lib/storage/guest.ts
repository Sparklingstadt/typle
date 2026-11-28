import { AppError } from '../appError'
import { applyChange, decodeDocument, type WorkspaceDocument } from '../workspaceDocument'
import { MAX_WORKSPACE_BYTES, validateWorkspaceRequest } from '../workspaceRequest'
import { followOfficial, withoutFollowedWords, type OfficialPack } from '../followedPacks'
import { decodeInterests } from '../interests'
import { GUEST_ACCOUNT_ID, GUEST_STORAGE_KEY } from './guestAccount'
import { addRecord, deleteRecord } from '../records'
import { WorkspaceError, type RecordAdd, type RecordDelete, type WorkspaceState, type WorkspaceWrite } from '../workspaceStore'

// Followed packs are brought in line with the catalog on every read and write. The caller gives the catalog
// (`official`), so that this file does not bring the official packs' words with it: guestStore.ts loads those of the
// packs the workspace follows; the tests give the whole catalog.
const followed = <T extends { lists: WorkspaceDocument['lists']; packs: WorkspaceDocument['packs'] }>(state: T, official: OfficialPack[]): T =>
  ({ ...state, ...followOfficial({ lists: state.lists, packs: state.packs }, official) })
// Larger than the account's limit, so that a save near it still fits with the rest of the workspace.
const MAX_GUEST_BYTES = MAX_WORKSPACE_BYTES * 10

function bytes(value: string) {
  return new TextEncoder().encode(value).length
}

type Stored = WorkspaceDocument & { revision: number }

const empty = (revision: number): Stored => ({ lists: [], packs: [], devices: [], interests: decodeInterests(undefined), revision })

function readDocument(storage: Storage): Stored {
  const raw = storage.getItem(GUEST_STORAGE_KEY)
  if (raw === null) return empty(0)
  try {
    if (bytes(raw) > MAX_GUEST_BYTES) throw new Error('Too large')
    const value = JSON.parse(raw)
    if (value.version !== 1 || value.accountId !== GUEST_ACCOUNT_ID) throw new Error('Invalid guest workspace')
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid revision')
    // Data saved before v1.0.0, with profiles or without packs, is no longer read: the workspace is empty, and the next
    // save replaces it.
    if (value.profiles !== undefined || value.packs === undefined || value.packs === null) return empty(value.revision)
    const { lists, packs, devices, interests } = decodeDocument(value)
    return { lists, packs, devices, interests, revision: value.revision }
  } catch {
    throw new AppError('guestReadFailed')
  }
}

function store(storage: Storage, { lists, packs, devices, interests, revision }: Stored): WorkspaceState {
  const raw = JSON.stringify({ version: 1, accountId: GUEST_ACCOUNT_ID, revision, ...withoutFollowedWords({ lists, packs }), devices, interests })
  if (!Number.isSafeInteger(revision) || bytes(raw) > MAX_GUEST_BYTES) throw new AppError('guestQuotaExceeded')
  try { storage.setItem(GUEST_STORAGE_KEY, raw) }
  catch { throw new AppError('guestWriteFailed') }
  return { lists, packs, devices, interests, revision, accountId: GUEST_ACCOUNT_ID }
}

// Followed packs are brought in line with the catalog on every read and write (followed), and saved without their
// words (withoutFollowedWords). A read that changes them does not save them; the next write does.

export function readGuestWorkspace(official: OfficialPack[], storage: Storage = localStorage): WorkspaceState {
  return followed({ ...readDocument(storage), accountId: GUEST_ACCOUNT_ID }, official)
}

export function writeGuestWorkspace(request: WorkspaceWrite, official: OfficialPack[], storage: Storage = localStorage): WorkspaceState {
  if (request.accountId !== GUEST_ACCOUNT_ID) throw new AppError('storageChanged')
  const previous = readDocument(storage)
  if (previous.revision !== request.revision) throw new WorkspaceError('conflict', 409)
  const change = validateWorkspaceRequest(request)
  if ((change.lists || change.packs) && bytes(JSON.stringify({ lists: change.lists, packs: change.packs })) > MAX_WORKSPACE_BYTES) throw new AppError('guestQuotaExceeded')
  return followed(store(storage, { ...applyChange(previous, change), revision: change.revision + 1 }), official)
}

// Adds a run as the account's /api/workspace/records does: on whatever is stored now, without a revision, and to the
// lists as a read shows them (followed packs in line with the catalog), where the run was practised.
export function addGuestRecord(request: RecordAdd, official: OfficialPack[], storage: Storage = localStorage): WorkspaceState {
  if (request.accountId !== GUEST_ACCOUNT_ID) throw new AppError('storageChanged')
  const previous = followed(readDocument(storage), official)
  const { document, added } = addRecord(previous, request.listId, request.record)
  if (!added) return { ...previous, accountId: GUEST_ACCOUNT_ID }
  if (bytes(JSON.stringify({ lists: document.lists, packs: document.packs })) > MAX_WORKSPACE_BYTES) throw new AppError('guestQuotaExceeded')
  return followed(store(storage, { ...document, revision: previous.revision + 1 }), official)
}

// Deletes a run as the account's /api/workspace/records does: on whatever is stored now, without a revision.
export function deleteGuestRecord(request: RecordDelete, official: OfficialPack[], storage: Storage = localStorage): WorkspaceState {
  if (request.accountId !== GUEST_ACCOUNT_ID) throw new AppError('storageChanged')
  const previous = followed(readDocument(storage), official)
  const { document, deleted } = deleteRecord(previous, request.listId, request.recordId)
  if (!deleted) return { ...previous, accountId: GUEST_ACCOUNT_ID }
  return followed(store(storage, { ...document, revision: previous.revision + 1 }), official)
}

/** The packs saved in this browser, to load the official packs they follow before reading; none when there is nothing to read or it cannot be read. */
export function savedGuestPacks(storage: Storage = localStorage): WorkspaceDocument['packs'] {
  try { return readDocument(storage).packs } catch { return [] }
}

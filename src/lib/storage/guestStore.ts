import type { OfficialPack } from '../followedPacks'
import type { WordPack } from '../wordPacks'
import type { WorkspaceStore } from '../workspaceStore'
import { addGuestRecord, deleteGuestRecord, readGuestWorkspace, savedGuestPacks, writeGuestWorkspace } from './guest'
import { GUEST_STORAGE_KEY } from './guestAccount'

// Serialize read/check/write across tabs where the Web Locks API is available.
function locked<T>(action: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(GUEST_STORAGE_KEY, action)
  return Promise.resolve(action())
}

/**
 * Runs `action` on the guest workspace with the catalog it is brought in line with: the official packs that the saved
 * packs and `more` (the packs being saved) follow are loaded first, and nothing is loaded for a workspace without
 * packs, so the catalog stays out of the scripts of every page. Another tab can follow a pack while they load: the
 * action then waits for that one too.
 */
async function withCatalog<T>(more: readonly WordPack[], lock: boolean, action: (official: OfficialPack[]) => T): Promise<T> {
  for (;;) {
    const packs = () => [...savedGuestPacks(), ...more]
    const catalog = packs().length ? await import('../packs/officialCatalog') : null
    await catalog?.loadFollowed(packs())
    const attempt = () => {
      const now = packs()
      const official = now.length ? catalog?.catalogFor(now) : []
      return official ? { result: action(official) } : null
    }
    const done = await (lock ? locked(attempt) : attempt())
    if (done) return done.result
  }
}

/** The guest workspace in this browser's LocalStorage. */
export const guestStore: WorkspaceStore = {
  location: 'browser',
  read: () => withCatalog([], false, official => readGuestWorkspace(official)),
  write: request => withCatalog(request.packs ?? [], true, official => writeGuestWorkspace(request, official)),
  addRecord: request => withCatalog([], true, official => addGuestRecord(request, official)),
  deleteRecord: request => withCatalog([], true, official => deleteGuestRecord(request, official)),
  staleReads: false,
  subscribe(onChange) {
    // `key` is null when another tab clears the whole storage.
    const changed = (event: StorageEvent) => { if (event.key === GUEST_STORAGE_KEY || event.key === null) onChange() }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  },
}

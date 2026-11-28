import { decodeInterests } from '../interests'
import type { WorkspaceState, WorkspaceStore } from '../workspaceStore'
import { GUEST_ACCOUNT_ID, GUEST_STORAGE_KEY } from './guestAccount'

// guest.ts brings the catalog with it, so it is loaded when first needed and stays out of the scripts of every page.
const guest = () => import('./guest')

// A browser that has a saved workspace reads it as soon as the login is known: guest.ts is fetched meanwhile, not after.
// Storage that cannot be read is found out by the read itself.
try {
  if (typeof window !== 'undefined' && window.localStorage.getItem(GUEST_STORAGE_KEY) !== null) guest().catch(() => {})
} catch {}

// Serialize read/check/write across tabs where the Web Locks API is available.
function locked<T>(action: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(GUEST_STORAGE_KEY, action)
  return Promise.resolve(action())
}

// What readGuestWorkspace answers when nothing is saved; a first visit reads it without loading guest.ts.
const nothingSaved = (): WorkspaceState => ({ lists: [], packs: [], devices: [], interests: decodeInterests(undefined), revision: 0, accountId: GUEST_ACCOUNT_ID })

/** The guest workspace in this browser's LocalStorage. */
export const guestStore: WorkspaceStore = {
  location: 'browser',
  read: async () => localStorage.getItem(GUEST_STORAGE_KEY) === null ? nothingSaved() : (await guest()).readGuestWorkspace(localStorage),
  write: async request => { const { writeGuestWorkspace } = await guest(); return locked(() => writeGuestWorkspace(request)) },
  addRecord: async request => { const { addGuestRecord } = await guest(); return locked(() => addGuestRecord(request)) },
  deleteRecord: async request => { const { deleteGuestRecord } = await guest(); return locked(() => deleteGuestRecord(request)) },
  staleReads: false,
  subscribe(onChange) {
    // `key` is null when another tab clears the whole storage.
    const changed = (event: StorageEvent) => { if (event.key === GUEST_STORAGE_KEY || event.key === null) onChange() }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  },
}

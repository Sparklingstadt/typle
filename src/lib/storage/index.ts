import type { WorkspaceStore } from '../workspaceStore'
import { cloudStore } from './cloud'
import { GUEST_ACCOUNT_ID } from './guestAccount'
import { guestStore } from './guestStore'

/** The store that keeps `accountId`'s workspace: this browser for the guest, the cloud for a login. */
export function workspaceStore(accountId: string): WorkspaceStore {
  return accountId === GUEST_ACCOUNT_ID ? guestStore : cloudStore
}

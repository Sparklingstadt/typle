import type { Pool } from 'pg'
import { clientIp, countHit, LIMITS, undoHit } from './limits'

// The limits of the mails the app sends. Each is reserved (counted) before the mail is made, so requests sent together
// cannot all pass a limit while the first ones are still being sent; a reserved mail that is then not sent, or not
// delivered, still uses its share.
//
// - 3 an hour for one ID or address and 10 an hour for one client (LIMITS.mailTarget, mailIp), reserved before the
//   answer: they do not depend on whether the account exists, so forgot-password and forgot-id count them alike for
//   every ID and address.
// - 80 a UTC day for all mail (LIMITS.mailDaily), reserved only for a mail that is about to be sent, so that requests
//   for IDs and addresses with no account do not use it up.

type Db = Pick<Pool, 'query'>

/**
 * Reserves one mail to target (a login ID or an address) for the request's client: true when both the client's and the
 * target's limits allow it. The client's limit is counted first; when the target's is already blocked, the client's
 * hit is taken back, so that a blocked target does not use up the client's share.
 */
export async function reserveMail(db: Db, request: Request, target: string, now: Date = new Date()): Promise<boolean> {
  const ipLimit = LIMITS.mailIp(clientIp(request))
  if (!(await countHit(db, ipLimit, now)).counted) return false
  if ((await countHit(db, LIMITS.mailTarget(target), now)).counted) return true
  await undoHit(db, ipLimit.key, now)
  return false
}

/** Reserves one mail of the UTC day's cap of all mail (under scope, LoginSettings.mailCapScope): true when it allows it. */
export async function reserveDailyMail(db: Db, scope: string, now: Date = new Date()): Promise<boolean> {
  const day = now.toISOString().slice(0, 10)
  return (await countHit(db, LIMITS.mailDaily(scope, day), now)).counted
}

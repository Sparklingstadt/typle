import { timingSafeEqual } from 'node:crypto'
import type { Db } from './database'
import { DEMO_USER } from './demoLogin'
import { demoWorkspace } from './demoWorkspace'
import { reportFailure } from './report'
import { methodNotAllowed, refuse, reply } from './response'
import { Conflict, readWorkspace, writeWorkspace, type SavedWorkspace } from './workspace'

// Putting the shared demo account back to its sample, every day at 4:00 in Japan (vercel.json's cron calls
// GET /api/demo/reset at 19:00 UTC).

/** How many times a reset is tried when a visitor's save comes between its read and its write. */
const ATTEMPTS = 3

/**
 * Writes the sample over owner's workspace as a save would (writeWorkspace): its records become the sample's, and the
 * revision goes up, never back to 1, so that a screen still open on the old data gets a conflict and reads it again.
 * The sessions are left alone: a visitor stays signed in and sees the sample on the next read.
 */
export async function resetDemoWorkspace(db: Db, now = new Date(), owner = DEMO_USER.id): Promise<SavedWorkspace> {
  for (let attempt = 1; ; attempt++) {
    const saved = await readWorkspace(db, owner)
    try {
      return await writeWorkspace(db, owner, saved?.revision ?? 0, demoWorkspace(now))
    } catch (error) {
      if (!(error instanceof Conflict) || attempt >= ATTEMPTS) throw error
    }
  }
}

/** Whether authorization is `Bearer <secret>`, compared in constant time. A blank secret matches nothing. */
function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false
  const given = Buffer.from(authorization)
  const wanted = Buffer.from(`Bearer ${secret}`)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/**
 * GET /api/demo/reset, which Vercel Cron calls with `Authorization: Bearer <CRON_SECRET>`: 401 without that secret,
 * 404 while the demo login is off, else the reset and the revision it saved.
 */
export async function answerDemoReset(request: Request, reset: () => Promise<{ revision: number }>,
  env: Record<string, string | undefined> = process.env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET'])
  if (!cronAuthorized(request.headers.get('authorization'), env.CRON_SECRET)) return refuse(401, 'loginRequired')
  if (env.DEMO_LOGIN !== '1') return refuse(404, 'notFound')
  try {
    const { revision } = await reset()
    return reply(200, { revision })
  } catch (error) {
    reportFailure(request, error, 'demo.reset')
    return refuse(503, 'databaseUnavailable')
  }
}

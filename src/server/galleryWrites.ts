import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { overLimit } from './rateLimit'
import { reportFailure } from './report'
import { fromAppOrOrigin, jsonContent, readStringFields } from './request'
import { forGallery, refuse } from './response'
import { readLoginSettings, type LoginSettings } from './settings'
import { isLinkId } from './shared'

// The gallery's writes, which need no account: counting an add of a pack to someone's packs, and reporting a pack.
// Both must come from the app (its own pages, or an app's token) and are limited per client.

/** The most adds and reports one client may make in a minute. */
const ADDED_PER_MINUTE = 60
const REPORTS_PER_MINUTE = 10

/** The reasons a gallery pack can be reported for. */
const REPORT_REASONS = ['inappropriate', 'spam', 'personalInfo', 'other']

/** The most a report's body needs: a pack id and a reason, and room to spare. */
const MAX_REPORT_BYTES = 4096

const noContent = () => forGallery(new Response(null, { status: 204 }))

/**
 * POST /api/gallery/added?id=: one more add of the listed pack id. A pack that is not in the gallery is answered the
 * same 204, so that the answer does not tell which shares are listed.
 */
export async function answerGalleryAdded(request: Request, open: () => Pool, settings: () => LoginSettings | null = readLoginSettings): Promise<Response> {
  const login = settings()
  if (!login) return forGallery(refuse(503, 'authUnavailable'))
  if (!fromAppOrOrigin(request, login.origin)) return forGallery(refuse(403, 'forbiddenRequest'))
  const id = new URL(request.url).searchParams.get('id') ?? ''
  let operation = 'gallery.limit'
  try {
    const db = open()
    const limited = await overLimit(request, db, login, 'added', ADDED_PER_MINUTE)
    if (limited) return limited
    operation = 'gallery.added'
    if (isLinkId(id)) {
      await db.query(`UPDATE typle_shared_packs SET add_count = add_count + 1
        WHERE id = $1 AND listed_at IS NOT NULL AND hidden_at IS NULL`, [id])
    }
  } catch (error) {
    reportFailure(request, error, operation)
    return forGallery(refuse(503, 'databaseUnavailable'))
  }
  return noContent()
}

/**
 * POST /api/gallery/reports with {"id","reason"}: a report of a listed pack. A share that is not in the gallery is
 * notInGallery, so that the page of a link-only share does not hear that it has ended.
 */
export async function answerGalleryReport(request: Request, open: () => Pool, settings: () => LoginSettings | null = readLoginSettings): Promise<Response> {
  const login = settings()
  if (!login) return forGallery(refuse(503, 'authUnavailable'))
  if (!fromAppOrOrigin(request, login.origin) || !jsonContent(request)) return forGallery(refuse(403, 'forbiddenRequest'))
  const fields = await readStringFields(request, MAX_REPORT_BYTES, ['id', 'reason'])
  if (!fields || !REPORT_REASONS.includes(fields.reason)) return forGallery(refuse(400, 'invalidReport'))
  let operation = 'gallery.limit'
  let found: boolean
  try {
    const db = open()
    const limited = await overLimit(request, db, login, 'reports', REPORTS_PER_MINUTE)
    if (limited) return limited
    operation = 'gallery.report'
    found = isLinkId(fields.id) && await insertReport(db, fields.id, fields.reason)
  } catch (error) {
    reportFailure(request, error, operation)
    return forGallery(refuse(503, 'databaseUnavailable'))
  }
  return found ? noContent() : forGallery(refuse(404, 'notInGallery'))
}

/** Records a report of the share id when it is listed and not hidden; false when there is no such share. */
async function insertReport(db: Pool, id: string, reason: string): Promise<boolean> {
  try {
    const { rowCount } = await db.query(`INSERT INTO typle_gallery_reports (id, share_id, reason)
      SELECT $1, id, $3 FROM typle_shared_packs WHERE id = $2 AND listed_at IS NOT NULL AND hidden_at IS NULL`,
    [randomUUID(), id, reason])
    return rowCount === 1
  } catch (error) {
    // The share can be deleted between the statement's snapshot and the foreign key check: it is gone then.
    if ((error as { code?: string }).code === '23503') return false
    throw error
  }
}

import type { Pool, PoolClient } from 'pg'
import { reportFailure } from './report'
import { jsonContent, readStringFields } from './request'
import { refuse, reply } from './response'
import { adminCookieName, openAdmin, type Admin } from './session'
import { readLoginSettings, type LoginSettings } from './settings'
import { isLinkId } from './shared'

// The administrator's dashboard (/admin) and its API, /api/admin/*. The login to it goes through FFPF ID and ends with
// the administrator's cookie (still the Go backend's /api/auth/callback/ffpf), for an account that typle_admins lets in:
// one registered there by its email, which binds the account's sub at its first sign-in. Every request asks
// typle_admins again, so an administrator whose row is removed is let in no longer.

/** How many shared packs the dashboard lists, and how many accounts one page of the user list holds. */
const RECENT_SHARES = 20
const USERS_PAGE = 50
/** Keeps the OFFSET of a made-up page number from making the database walk far. */
const MAX_USERS_PAGE = 10_000
/** How many packs the gallery list holds at most. */
const GALLERY_ROWS = 100
/** The most a hide's body needs: a pack id, and room to spare. */
const MAX_ID_BODY_BYTES = 4 << 10

/** The value of the cookie name in the request, the first one when there are several; quotes around it are dropped. */
function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at < 0 || part.slice(0, at).trim() !== name) continue
    const value = part.slice(at + 1).trim()
    return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
  }
  return null
}

/**
 * Whether the FFPF ID account with the verified email (any case) and the sub is an administrator, binding the sub to
 * its row when it has none yet and noting when it was last seen. An empty email or sub is no account, and is answered
 * false without asking: an empty sub must never be bound to a row.
 */
export async function isAdmin(db: Pool, email: string, sub: string): Promise<boolean> {
  if (!email || !sub) return false
  const { rowCount } = await db.query(`UPDATE typle_admins SET ffpf_sub = $2, last_seen_at = now()
    WHERE email = lower($1) AND (ffpf_sub IS NULL OR ffpf_sub = $2) RETURNING 1`, [email, sub])
  return rowCount === 1
}

/**
 * The administrator of the request, or the answer to refuse it with: adminRequired without a valid cookie, and
 * adminForbidden, with the cookie removed, when typle_admins no longer lets the account in.
 */
async function administrator(request: Request, db: Pool, login: LoginSettings): Promise<{ admin: Admin } | { refusal: Response }> {
  const cookie = cookieValue(request, adminCookieName(login.secure))
  const admin = cookie === null ? null : openAdmin(login.adminKey, cookie)
  if (!admin) return { refusal: refuse(401, 'adminRequired') }
  let allowed: boolean
  try {
    allowed = await isAdmin(db, admin.email, admin.sub)
  } catch (error) {
    reportFailure(request, error, 'admin.check')
    return { refusal: refuse(503, 'databaseUnavailable') }
  }
  if (!allowed) {
    const refusal = refuse(403, 'adminForbidden')
    const secure = login.secure ? '; Secure' : ''
    refusal.headers.append('Set-Cookie', `${adminCookieName(login.secure)}=; Path=/; Max-Age=0; HttpOnly${secure}; SameSite=Strict`)
    return { refusal }
  }
  return { admin }
}

/** Runs read in one read-only REPEATABLE READ transaction, so that the figures it reads agree with each other. */
async function snapshot<T>(db: Pool, read: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const result = await read(client)
    await client.query('COMMIT')
    client.release()
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    client.release(true)
    throw error
  }
}

const time = (value: Date | null) => value === null ? null : value.toISOString()

/** What the dashboard shows: how many accounts saved, were active, and shared, the newest shares, and the administrators. */
async function overview(db: Pool) {
  return snapshot(db, async client => {
    const { rows: [counts] } = await client.query<{ workspaces: number, day: number, week: number, month: number, shared: number }>(
      `SELECT count(*)::int AS workspaces,
        count(*) FILTER (WHERE updated_at > now() - interval '1 day')::int AS day,
        count(*) FILTER (WHERE updated_at > now() - interval '7 days')::int AS week,
        count(*) FILTER (WHERE updated_at > now() - interval '30 days')::int AS month,
        (SELECT count(*) FROM typle_shared_packs)::int AS shared
      FROM typle_workspaces`)
    const { rows: shares } = await client.query<{ id: string, owner_id: string, name: string, updated_at: Date }>(
      `SELECT id::text, owner_id, COALESCE(data #>> '{pack,name}', '') AS name, updated_at
      FROM typle_shared_packs ORDER BY updated_at DESC, id LIMIT $1`, [RECENT_SHARES])
    const { rows: admins } = await client.query<{ email: string, ffpf_sub: string | null, created_at: Date, last_seen_at: Date | null }>(
      'SELECT email, ffpf_sub, created_at, last_seen_at FROM typle_admins ORDER BY email')
    return {
      workspaces: counts.workspaces, activeDay: counts.day, activeWeek: counts.week, activeMonth: counts.month, sharedPacks: counts.shared,
      recentShares: shares.map(row => ({ id: row.id, ownerId: row.owner_id, name: row.name, updatedAt: time(row.updated_at) })),
      admins: admins.map(row => ({ email: row.email, ffpfSub: row.ffpf_sub, createdAt: time(row.created_at), lastSeenAt: time(row.last_seen_at) })),
    }
  })
}

/** One page (from 0) of the accounts that saved their workspace, the most recently updated first, and how many in all. */
async function users(db: Pool, page: number) {
  return snapshot(db, async client => {
    const { rows: [{ total }] } = await client.query<{ total: number }>('SELECT count(*)::int AS total FROM typle_workspaces')
    const { rows } = await client.query<{ owner_id: string, lists: number, packs: number, devices: number, shares: number, revision: number, updated_at: Date }>(
      `SELECT w.owner_id,
        CASE WHEN jsonb_typeof(w.lists) = 'array' THEN jsonb_array_length(w.lists) ELSE 0 END AS lists,
        CASE WHEN jsonb_typeof(w.packs) = 'array' THEN jsonb_array_length(w.packs) ELSE 0 END AS packs,
        CASE WHEN jsonb_typeof(w.devices) = 'array' THEN jsonb_array_length(w.devices) ELSE 0 END AS devices,
        (SELECT count(*) FROM typle_shared_packs s WHERE s.owner_id = w.owner_id)::int AS shares,
        w.revision, w.updated_at
      FROM typle_workspaces w ORDER BY w.updated_at DESC, w.owner_id LIMIT $1 OFFSET $2`, [USERS_PAGE, page * USERS_PAGE])
    return {
      total,
      users: rows.map(row => ({
        ownerId: row.owner_id, lists: row.lists, packs: row.packs, devices: row.devices, shares: row.shares,
        revision: row.revision, updatedAt: time(row.updated_at),
      })),
    }
  })
}

/** The listed or hidden shares with their reports: the most reported first, then the latest report, then listed_at. */
async function galleryPacks(db: Pool) {
  const { rows } = await db.query<{ id: string, name: string, category: string, added: number, listed_at: Date | null, hidden_at: Date | null, reports: number, reasons: Record<string, number> }>(
    `SELECT p.id::text, COALESCE(p.data #>> '{pack,name}', '') AS name,
        COALESCE(p.data #>> '{pack,category}', '') AS category, p.add_count AS added, p.listed_at, p.hidden_at,
        COALESCE(r.reports, 0) AS reports, COALESCE(r.reasons, '{}'::jsonb) AS reasons
      FROM typle_shared_packs p
      LEFT JOIN (SELECT share_id, sum(n)::int AS reports, max(last) AS last, jsonb_object_agg(reason, n) AS reasons
        FROM (SELECT share_id, reason, count(*) AS n, max(created_at) AS last
          FROM typle_gallery_reports GROUP BY share_id, reason) AS by_reason
        GROUP BY share_id) AS r ON r.share_id = p.id
      WHERE p.listed_at IS NOT NULL OR p.hidden_at IS NOT NULL
      ORDER BY COALESCE(r.reports, 0) DESC, r.last DESC NULLS LAST, p.listed_at DESC NULLS LAST, p.id
      LIMIT $1`, [GALLERY_ROWS])
  // A category that is empty is left out, as Go's omitempty did.
  return rows.map(row => ({
    id: row.id, name: row.name, ...(row.category ? { category: row.category } : {}), added: row.added,
    listedAt: time(row.listed_at), hiddenAt: time(row.hidden_at), reports: row.reports,
    // jsonb orders keys by length; Go wrote a map's keys in byte order.
    reasons: Object.fromEntries(Object.entries(row.reasons).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
  }))
}

/**
 * Hides the share id from the gallery, or shows it again, leaving listed_at as it is. Hiding a hidden share keeps its
 * first time. False when there is no such share.
 */
export async function setHidden(db: Pool, id: string, hidden: boolean): Promise<boolean> {
  if (!isLinkId(id)) return false
  const { rowCount } = await db.query(`UPDATE typle_shared_packs
    SET hidden_at = CASE WHEN $2::boolean THEN COALESCE(hidden_at, now()) END WHERE id = $1`, [id, hidden])
  return rowCount === 1
}

/** The page of ?page=: 0 when it is left out, null when it is not an integer as Go's strconv.Atoi reads one. */
function queryPage(request: Request): number | null {
  const value = new URL(request.url).searchParams.get('page') ?? ''
  if (value === '') return 0
  return /^[+-]?\d+$/.test(value) ? Number(value) : null
}

/** The answer of a write that has nothing to show. */
const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })

export type AdminPath = 'dashboard' | 'users' | 'gallery' | 'hide' | 'unhide'

/**
 * /api/admin/*: GET dashboard, users?page= and gallery to the administrator, and POST gallery/hide and gallery/unhide
 * {"id"}, which must come from the app's own pages: an app's token does not stand in for the Origin here.
 */
export async function answerAdmin(path: AdminPath, request: Request, open: () => Pool, settings: () => LoginSettings | null = readLoginSettings): Promise<Response> {
  const login = settings()
  if (!login) return refuse(503, 'authUnavailable')
  let db: Pool
  try {
    db = open()
  } catch (error) {
    reportFailure(request, error, 'admin.open')
    return refuse(503, 'databaseUnavailable')
  }
  const allowed = await administrator(request, db, login)
  if ('refusal' in allowed) return allowed.refusal
  const { admin } = allowed

  if (path === 'hide' || path === 'unhide') {
    if (request.headers.get('Origin') !== login.origin || !jsonContent(request)) return refuse(403, 'forbiddenRequest')
    const fields = await readStringFields(request, MAX_ID_BODY_BYTES, ['id']).catch(() => null)
    if (!fields) return refuse(400, 'invalidRequest')
    try {
      if (!await setHidden(db, fields.id, path === 'hide')) return refuse(404, 'sharedPackNotFound')
    } catch (error) {
      reportFailure(request, error, 'admin.hide')
      return refuse(503, 'databaseUnavailable')
    }
    return noContent()
  }
  if (path === 'users') {
    const page = queryPage(request)
    if (page === null || page < 0 || page > MAX_USERS_PAGE) return refuse(400, 'invalidPage')
    try {
      const { total, users: list } = await users(db, page)
      return reply(200, { page, pageSize: USERS_PAGE, total, users: list })
    } catch (error) {
      reportFailure(request, error, 'admin.users')
      return refuse(503, 'databaseUnavailable')
    }
  }
  if (path === 'gallery') {
    try {
      return reply(200, { packs: await galleryPacks(db) })
    } catch (error) {
      reportFailure(request, error, 'admin.gallery')
      return refuse(503, 'databaseUnavailable')
    }
  }
  try {
    return reply(200, { admin: { email: admin.email, sub: admin.sub }, overview: await overview(db) })
  } catch (error) {
    reportFailure(request, error, 'admin.overview')
    return refuse(503, 'databaseUnavailable')
  }
}

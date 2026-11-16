import type { Pool } from 'pg'
import { reportFailure } from './report'
import { forGallery, refuse, reply } from './response'

// The gallery is the shares their owners list (listed_at) and the operator has not hidden (hidden_at). Anyone may read
// it, signed in or not, and an answer never names the owner.

/** The number of packs a page of the gallery has. */
const GALLERY_PAGE_SIZE = 20
/** The longest search text, in code points; a longer one is cut. */
const MAX_GALLERY_QUERY = 200
/** The last page that may be asked for, so that the OFFSET of a made-up page cannot make the database walk far. */
const MAX_GALLERY_PAGE = 10000

export type GallerySort = 'new' | 'popular'

/** A search of the gallery: text anywhere in the name, the description or the tags; category the whole category. */
export type GalleryQuery = { text: string, category: string, sort: GallerySort, page: number }

/** A listed pack as /api/gallery answers it. Empty labels are left out. */
type GalleryPack = {
  id: string, name: string, description?: string, category?: string, tags?: string[],
  lists: number, words: number, added: number, updatedAt: string,
}

type GalleryCategory = { name: string, count: number }

// The white space Go's strings.TrimSpace removes (unicode.IsSpace).
const GO_SPACE = '[\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]'
const EDGE_SPACE = new RegExp(`^${GO_SPACE}+|${GO_SPACE}+$`, 'g')

/**
 * Reads ?q=&category=&sort=&page= as the Go backend did. null is a query to refuse with 400 invalidQuery: text or
 * category with a NUL, a sort other than new or popular, or a page that is not a whole number from 1 to
 * MAX_GALLERY_PAGE. Next.js hands the query over as URLSearchParams wrote it again, so an escape that is not UTF-8
 * (%FF) arrives as U+FFFD and is searched for, where Go refused it.
 */
export function parseGalleryQuery(url: URL): GalleryQuery | null {
  const params = url.searchParams
  const text = params.get('q') ?? ''
  const category = params.get('category') ?? ''
  const sort = params.get('sort') ?? ''
  const page = params.get('page') ?? ''
  if (text.includes('\0') || category.includes('\0')) return null
  if (sort !== '' && sort !== 'new' && sort !== 'popular') return null
  // strconv.Atoi: an optional sign and decimal digits, nothing else.
  if (page !== '' && !/^[+-]?\d+$/.test(page)) return null
  const pageNumber = page === '' ? 1 : Number(page)
  if (pageNumber < 1 || pageNumber > MAX_GALLERY_PAGE) return null
  return {
    text: [...text.replace(EDGE_SPACE, '')].slice(0, MAX_GALLERY_QUERY).join(''),
    category,
    sort: sort === 'popular' ? 'popular' : 'new',
    page: pageNumber,
  }
}

/** Escapes the characters LIKE treats as wildcards, for ESCAPE '\'. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, character => '\\' + character)

/** One page of the listed packs; more is whether a next page has packs. */
export async function readGallery(db: Pool, query: GalleryQuery): Promise<{ packs: GalleryPack[], more: boolean }> {
  const order = query.sort === 'popular' ? 'add_count DESC, listed_at DESC, id' : 'listed_at DESC, id'
  const { rows } = await db.query<{
    id: string, name: string, description: string, category: string, tags: string[] | null,
    lists: number, words: number, added: number, updated_at: Date,
  }>(`SELECT id::text AS id, COALESCE(data #>> '{pack,name}', '') AS name,
      COALESCE(data #>> '{pack,description}', '') AS description, COALESCE(data #>> '{pack,category}', '') AS category,
      data #> '{pack,tags}' AS tags, COALESCE(jsonb_array_length(data -> 'lists'), 0) AS lists,
      COALESCE((SELECT sum(jsonb_array_length(l -> 'words')) FROM jsonb_array_elements(data -> 'lists') AS l), 0)::int AS words,
      add_count AS added, updated_at
    FROM typle_shared_packs
    WHERE listed_at IS NOT NULL AND hidden_at IS NULL
      AND ($2 = '' OR data #>> '{pack,category}' = $2)
      AND ($1 = '' OR data #>> '{pack,name}' ILIKE '%' || $1 || '%' ESCAPE '\\'
        OR data #>> '{pack,description}' ILIKE '%' || $1 || '%' ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(data #> '{pack,tags}', '[]'::jsonb)) AS t
          WHERE t ILIKE '%' || $1 || '%' ESCAPE '\\'))
    ORDER BY ${order} LIMIT $3 OFFSET $4`,
  [escapeLike(query.text), query.category, GALLERY_PAGE_SIZE + 1, (query.page - 1) * GALLERY_PAGE_SIZE])
  const packs = rows.slice(0, GALLERY_PAGE_SIZE).map(row => ({
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    ...(row.category ? { category: row.category } : {}),
    ...(row.tags?.length ? { tags: row.tags } : {}),
    lists: row.lists,
    words: row.words,
    added: row.added,
    updatedAt: row.updated_at.toISOString(),
  }))
  return { packs, more: rows.length > GALLERY_PAGE_SIZE }
}

/** The categories of the listed packs, the most packs first; the same count in the app's order for Japanese names. */
export async function readGalleryCategories(db: Pool): Promise<GalleryCategory[]> {
  const { rows } = await db.query<GalleryCategory>(`SELECT data #>> '{pack,category}' AS name, count(*)::int AS count
    FROM typle_shared_packs
    WHERE listed_at IS NOT NULL AND hidden_at IS NULL AND COALESCE(data #>> '{pack,category}', '') <> ''
    GROUP BY 1`)
  const collator = new Intl.Collator('ja')
  return rows.sort((a, b) => b.count - a.count || collator.compare(a.name, b.name))
}

/** GET /api/gallery: one page of the listed packs. */
export async function answerGallery(request: Request, open: () => Pool): Promise<Response> {
  const query = parseGalleryQuery(new URL(request.url))
  if (!query) return forGallery(refuse(400, 'invalidQuery'))
  try {
    return forGallery(reply(200, await readGallery(open(), query)))
  } catch (error) {
    reportFailure(request, error, 'gallery.read')
    return forGallery(refuse(503, 'databaseUnavailable'))
  }
}

/** GET /api/gallery/categories: the categories of the listed packs. */
export async function answerGalleryCategories(request: Request, open: () => Pool): Promise<Response> {
  try {
    return forGallery(reply(200, { categories: await readGalleryCategories(open()) }))
  } catch (error) {
    reportFailure(request, error, 'gallery.categories')
    return forGallery(refuse(503, 'databaseUnavailable'))
  }
}

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

/**
 * The value of the query parameter name as Go's url.Values.Get read it: the first pair with that name. A pair with a
 * malformed escape or a semicolon is skipped, as Go's url.ParseQuery skips it. invalid is true when the value is not
 * UTF-8 (`%FF`), which URLSearchParams would quietly turn into U+FFFD.
 */
function queryValue(url: URL, name: string): { value: string, invalid: boolean } {
  for (const pair of url.search.slice(1).split('&')) {
    if (!pair || pair.includes(';')) continue
    const [rawKey, rawValue = ''] = splitOnce(pair, '=')
    if (/%(?![0-9a-fA-F]{2})/.test(rawKey) || /%(?![0-9a-fA-F]{2})/.test(rawValue)) continue
    let key: string
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
    } catch {
      continue
    }
    if (key !== name) continue
    try {
      return { value: decodeURIComponent(rawValue.replace(/\+/g, ' ')), invalid: false }
    } catch {
      return { value: '', invalid: true }
    }
  }
  return { value: '', invalid: false }
}

function splitOnce(text: string, separator: string): [string, string?] {
  const at = text.indexOf(separator)
  return at < 0 ? [text] : [text.slice(0, at), text.slice(at + 1)]
}

// The white space Go's strings.TrimSpace removes (unicode.IsSpace).
const GO_SPACE = '[\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]'
const EDGE_SPACE = new RegExp(`^${GO_SPACE}+|${GO_SPACE}+$`, 'g')

/**
 * Reads ?q=&category=&sort=&page= as the Go backend did. null is a query to refuse with 400 invalidQuery: text or
 * category that is not UTF-8 or has a NUL, a sort other than new or popular, or a page that is not a whole number
 * from 1 to MAX_GALLERY_PAGE.
 */
export function parseGalleryQuery(url: URL): GalleryQuery | null {
  const text = queryValue(url, 'q')
  const category = queryValue(url, 'category')
  const sort = queryValue(url, 'sort')
  const page = queryValue(url, 'page')
  if ([text, category, sort, page].some(field => field.invalid)) return null
  if (text.value.includes('\0') || category.value.includes('\0')) return null
  if (sort.value !== '' && sort.value !== 'new' && sort.value !== 'popular') return null
  // strconv.Atoi: an optional sign and decimal digits, nothing else.
  if (page.value !== '' && !/^[+-]?\d+$/.test(page.value)) return null
  const pageNumber = page.value === '' ? 1 : Number(page.value)
  if (pageNumber < 1 || pageNumber > MAX_GALLERY_PAGE) return null
  return {
    text: [...text.value.replace(EDGE_SPACE, '')].slice(0, MAX_GALLERY_QUERY).join(''),
    category: category.value,
    sort: sort.value === 'popular' ? 'popular' : 'new',
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

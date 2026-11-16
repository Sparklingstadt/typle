import { createHash } from 'node:crypto'

// Practice records are kept in typle_records, one row each, rather than in their lists (as the Go backend, removed in
// v2.47.0, kept them; docs/superpowers/specs/2026-10-29-record-table.md). A workspace whose records_split
// is false still has them in its lists, as saved before the table existed: the first save of its lists moves them.
// Reads put the records back in their lists, so the app sees lists with their records, as before.

/**
 * value as Go's strconv.FormatFloat(value, 'g', -1, 64) writes it: the shortest digits, in exponent form (two digits at
 * least, with a sign) when the exponent is below -4 or 6 and above, and plain otherwise.
 */
export function goFloat(value: number): string {
  if (value === 0) return Object.is(value, -0) ? '-0' : '0'
  const sign = value < 0 ? '-' : ''
  const magnitude = Math.abs(value)
  // toExponential() without digits gives the shortest digits that read back as the same number.
  const [mantissa, exponentText] = magnitude.toExponential().split('e')
  const exponent = Number(exponentText)
  if (exponent < -4 || exponent >= 6) {
    return `${sign}${mantissa}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`
  }
  // In this range String() writes the same shortest digits without an exponent.
  return sign + String(magnitude)
}

/**
 * The id a record saved without one is given, and one with the id of an earlier record of its list: the same record
 * gets the same id however often its list is saved or moved.
 */
export function legacyId(listId: string, position: number, record: { date: string, time: number }): string {
  const sum = createHash('sha256').update(`${listId}\0${position}\0${record.date}\0${goFloat(record.time)}`).digest('hex')
  return `legacy-${sum.slice(0, 20)}`
}

/** A record as typle_records keeps it: data is the record as its list held it, with its id; position its place. */
export type RecordRow = { listId: string, recordId: string, position: number, at: Date, data: string }

type ListWithRecords = { id: string, records: { id?: string, time: number, date: string }[] }

/**
 * The records of the lists as rows, every record given an id that keeps it apart from the rest of its list (legacyId),
 * in place, as the Go backend's recordRows did.
 */
export function recordRows(lists: ListWithRecords[]): RecordRow[] {
  const rows: RecordRow[] = []
  for (const list of lists) {
    const seen = new Set<string>()
    list.records.forEach((record, position) => {
      if (!record.id || seen.has(record.id)) record.id = legacyId(list.id, position, record)
      seen.add(record.id)
      rows.push({ listId: list.id, recordId: record.id, position, at: new Date(Date.parse(record.date)), data: JSON.stringify(record) })
    })
  }
  return rows
}

/**
 * The lists with the stored records put back in the lists that hold them, as the Go backend's withRecords did. A list
 * may still hold records of its own, saved by an app from before the table: they come first, and a record of the same id
 * is the table's. Records of a list that is no longer saved are left out; the next save deletes them.
 */
export function withRecords(lists: unknown[], stored: Map<string, unknown[]>): unknown[] {
  return lists.map(item => {
    const list = item as { id?: unknown, records?: unknown }
    const moved = typeof list.id === 'string' ? stored.get(list.id) ?? [] : []
    if (!moved.length) return item
    const movedIds = new Set(moved.map(recordIdOf))
    const own = Array.isArray(list.records) ? list.records : []
    const kept = own.filter(record => {
      const id = recordIdOf(record)
      return id === '' || !movedIds.has(id)
    })
    return { ...list, records: [...kept, ...moved] }
  })
}

const recordIdOf = (record: unknown) => {
  const id = (record as { id?: unknown } | null)?.id
  return typeof id === 'string' ? id : ''
}

/** Anything that runs queries: a pool, or the client of a transaction. */
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }

/**
 * Makes the owner's rows of typle_records exactly rows, as the Go backend's syncRecords did for a save of the lists:
 * the rows of records no longer saved are deleted, and the others written where they changed. The number of rows is
 * checked afterwards, so a save never leaves records behind or missing.
 */
export async function syncRecords(db: Queryable, owner: string, rows: RecordRow[]): Promise<void> {
  const lists = rows.map(row => row.listId)
  const ids = rows.map(row => row.recordId)
  await db.query(`DELETE FROM typle_records r WHERE r.owner_id = $1 AND NOT EXISTS (SELECT 1 FROM
    unnest($2::text[], $3::text[]) AS k(list_id, record_id) WHERE k.list_id = r.list_id AND k.record_id = r.record_id)`, [owner, lists, ids])
  if (rows.length) {
    await db.query(`INSERT INTO typle_records (owner_id, list_id, record_id, position, at, data)
      SELECT $1, k.list_id, k.record_id, k.position, k.at, k.data
      FROM unnest($2::text[], $3::text[], $4::int[], $5::timestamptz[], $6::jsonb[]) AS k(list_id, record_id, position, at, data)
      ON CONFLICT (owner_id, list_id, record_id) DO UPDATE SET position = EXCLUDED.position, at = EXCLUDED.at, data = EXCLUDED.data
      WHERE (typle_records.position, typle_records.at, typle_records.data) IS DISTINCT FROM (EXCLUDED.position, EXCLUDED.at, EXCLUDED.data)`,
    [owner, lists, ids, rows.map(row => row.position), rows.map(row => row.at), rows.map(row => row.data)])
  }
  const { rows: counted } = await db.query('SELECT count(*)::int AS n FROM typle_records WHERE owner_id = $1', [owner])
  if (counted[0].n !== rows.length) throw new Error(`records of ${owner}: ${counted[0].n} rows saved for ${rows.length} records`)
}

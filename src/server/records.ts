import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Tx } from './database'

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

/** The key of a record in typle_records within an owner's rows. */
const rowKey = (row: { listId: string, recordId: string }) => `${row.listId}\u0000${row.recordId}`

/**
 * Makes the owner's rows of typle_records exactly rows, as the Go backend's syncRecords did for a save of the lists.
 * The saved rows are compared with rows: those no longer saved, and those that changed, are deleted in one statement;
 * the new ones and the changed ones are then added in one INSERT, so a save costs the same few statements however
 * many records moved. A row that did not change is not written. The number of rows is checked afterwards, so a save
 * never leaves records behind or missing.
 */
export async function syncRecords(db: Tx, owner: string, rows: RecordRow[]): Promise<void> {
  const saved = new Map((await db.record.findMany({ where: { ownerId: owner } })).map(row => [rowKey(row), row]))
  const wanted = new Map(rows.map(row => [rowKey(row), row]))
  const removed = [...saved.values()].filter(row => !wanted.has(rowKey(row)))
  const written = rows.filter(row => {
    const before = saved.get(rowKey(row))
    if (!before) return true
    // jsonb keeps its own order of keys, so the data is compared as values, not as text.
    const same = before.position === row.position && before.at.getTime() === row.at.getTime() &&
      isDeepStrictEqual(before.data, JSON.parse(row.data))
    if (!same) removed.push(before)
    return !same
  })
  if (removed.length) {
    // One condition per list (its record ids), rather than one per record, keeps the statement small and quick.
    const byList = new Map<string, string[]>()
    for (const row of removed) byList.set(row.listId, [...byList.get(row.listId) ?? [], row.recordId])
    await db.record.deleteMany({
      where: { ownerId: owner, OR: [...byList].map(([listId, recordIds]) => ({ listId, recordId: { in: recordIds } })) },
    })
  }
  if (written.length) {
    // SQL, not createMany: Prisma's createMany took about 300 ms for 5000 rows, three times the save before it. One
    // INSERT of the rows sent as six arrays (unnest makes them rows again) takes a few milliseconds.
    await db.$executeRaw`INSERT INTO typle_records (owner_id, list_id, record_id, position, at, data)
      SELECT ${owner}, list_id, record_id, position, at, data
      FROM unnest(${written.map(row => row.listId)}::text[], ${written.map(row => row.recordId)}::text[],
        ${written.map(row => row.position)}::int[], ${written.map(row => row.at.toISOString())}::timestamptz[],
        ${written.map(row => row.data)}::jsonb[]) AS r(list_id, record_id, position, at, data)`
  }
  const count = await db.record.count({ where: { ownerId: owner } })
  if (count !== rows.length) throw new Error(`records of ${owner}: ${count} rows saved for ${rows.length} records`)
}

import { startOfDay } from "./dates"
import type { PracticeDevice } from "./devices"
import { listBest, PRACTICE_MODES, recentRecords, recordMode, type PracticeMode } from "./records"
import type { SavedWordList } from "./wordLists"

// The record history (練習記録): every record with its list, filtered by pack, list and device, and grouped by day.

type StoredRecord = SavedWordList['records'][number]

export type RecordRow = { list: SavedWordList; record: StoredRecord; index: number; key: string; best: boolean; mode: PracticeMode }
export type RecordFilter = { pack: string | null; list: string | null; device: string | null }
export const NO_DEVICE = 'none'

// Every record with its list, newest first. `best` marks the record that currently ranks first in its list among records of its own mode.
export function recordRows(lists: SavedWordList[]): RecordRow[] {
  // The badge means "best of its own mode": a record competes only with records of the same mode.
  const best = new Set(lists.flatMap(list => PRACTICE_MODES.flatMap(mode => listBest(list, mode) ?? [])))
  return recentRecords(lists).map(({ list, record, index }) =>
    ({ list, record, index, key: `${list.id}-${record.id ?? `${index}-${record.date}`}`, best: best.has(record), mode: recordMode(record) }))
}

export function matchesDevice(record: StoredRecord, device: string | null) {
  return !device || (device === NO_DEVICE ? !record.device : record.device?.id === device)
}

export function filterRows(rows: RecordRow[], filter: RecordFilter) {
  return rows.filter(row => (!filter.pack || row.list.packId === filter.pack) && (!filter.list || row.list.id === filter.list) && matchesDevice(row.record, filter.device))
}

// Devices come from the records themselves, so deleted or renamed devices can still be picked (by id, with the
// newest name). Records without a device (no `device`) are grouped last.
export function deviceOptions(records: StoredRecord[]) {
  const options = new Map<string, { value: string; device?: PracticeDevice; count: number }>()
  for (const record of [...records].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))) {
    const value = record.device?.id ?? NO_DEVICE
    const option = options.get(value)
    if (option) option.count++
    else options.set(value, { value, ...(record.device ? { device: record.device } : {}), count: 1 })
  }
  return [...options.values()].sort((a, b) => Number(a.value === NO_DEVICE) - Number(b.value === NO_DEVICE) || b.count - a.count)
}

// Days follow the viewer's local calendar, like the home dashboard.
export function groupByDay(rows: RecordRow[]) {
  const groups: { day: Date; rows: RecordRow[]; seconds: number }[] = []
  for (const row of rows) {
    const day = startOfDay(new Date(row.record.date))
    const last = groups[groups.length - 1]
    if (last && last.day.getTime() === day.getTime()) { last.rows.push(row); last.seconds += row.record.time }
    else groups.push({ day, rows: [row], seconds: row.record.time })
  }
  return groups
}

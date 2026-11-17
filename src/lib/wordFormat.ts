import { AppError } from './appError'
import { isInputType, type WordList } from './wordLists'

export type Word = WordList['words'][number]

/** Larger word files are refused before they are read. */
export const MAX_IMPORT_BYTES = 1024 * 1024

// Words are read from and written to CSV only (TSV was read until v2.43.3).
export const CSV_MIME_TYPE = 'text/csv;charset=utf-8'

/** The extension a file input accepts. */
export const IMPORT_ACCEPT = '.csv'

/** Whether a file with this name is a word CSV, by its extension in any case. */
export function isWordCsv(fileName: string) {
  return /\.csv$/i.test(fileName)
}

/** Read CSV, including escaped quotes and quoted multiline fields. */
export function parseWordCsv(source: string): Word[] {
  if (new TextEncoder().encode(source).length > MAX_IMPORT_BYTES) throw new AppError('importTooLarge')
  const text = source.replace(/^\uFEFF/, "")
  const rows: { cells: string[]; line: number }[] = []
  let cells: string[] = [], value = "", quoted = false, closed = false, line = 1, start = 1
  const fail = () => { throw new AppError('importQuote', { line }) }
  const field = () => { cells.push(value); value = ""; closed = false }
  const row = () => {
    const explicit = closed
    field()
    if (cells.length > 1 || cells.some(cell => cell.trim()) || explicit) rows.push({ cells, line: start })
    cells = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { value += '"'; i++ }
        else { quoted = false; closed = true }
      } else { value += c; if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++ }
    } else if (c === ",") field()
    else if (c === "\r" || c === "\n") {
      row()
      if (c === "\r" && text[i + 1] === "\n") i++
      line++; start = line
    } else if (closed) fail()
    else if (c === '"') { if (value) fail(); quoted = true }
    else value += c
  }
  if (quoted) fail()
  row()
  const header = rows.shift()?.cells.map(cell => cell.trim() === "anotation" ? "annotation" : cell.trim()) ?? []
  if (!header.includes("input") || !header.includes("display")) throw new AppError('importHeaderRequired')
  if (new Set(header).size !== header.length) throw new AppError('importHeaderDuplicate')
  if (header.some(name => !["input", "display", "annotation", "input_type"].includes(name))) throw new AppError('importHeaderUnknown')
  if (!rows.length) throw new AppError('importNoRows')
  if (rows.length > 1000) throw new AppError('importTooManyRows')
  return rows.map(({ cells, line }) => {
    if (cells.length !== header.length) throw new AppError('importColumnCount', { line })
    const get = (name: string) => (cells[header.indexOf(name)] ?? "")
    const inputType = get("input_type")
    if (inputType && !isInputType(inputType)) throw new AppError('importInputTypeInvalid', { line })
    const word: Word = { input: get("input"), display: get("display"), annotation: get("annotation"),
      ...(isInputType(inputType) ? { input_type: inputType } : {}) }
    if (!word.input.trim() || !word.display.trim()) throw new AppError('importFieldRequired', { line })
    if (word.input.length > 1000 || word.display.length > 1000 || word.annotation.length > 2000) throw new AppError('importFieldTooLong', { line })
    return word
  })
}

/** Preserve exact typing strings, including whitespace, quotes and newlines. */
export function encodeWordCsv(words: Word[]) {
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`
  const typed = words.some(word => word.input_type !== undefined)
  for (const word of words) {
    if (word.input_type !== undefined && !isInputType(word.input_type)) throw new AppError('savedDataCorrupted')
  }
  return `\uFEFFinput,display,annotation${typed ? ',input_type' : ''}\r\n` + words.map(word =>
    [word.input, word.display, word.annotation, ...(typed ? [word.input_type ?? ''] : [])].map(cell).join(",") + "\r\n"
  ).join("")
}

/** A file name for the list that every common OS accepts, ending in `.<extension>`. */
export function wordFilename(name: string, extension: string) {
  const safe = Array.from(name).map(char =>
    char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char
  ).join('').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80).replace(/[. ]+$/g, '')
  const base = safe || 'word-list'
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? '_' : ''}${base}.${extension}`
}

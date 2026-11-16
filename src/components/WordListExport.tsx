"use client"
import { CSV_MIME_TYPE, encodeWordCsv, wordFilename } from "@/core/wordFormat"
import type { SavedWordList } from "@/core/wordLists"

/** Downloads the list's words as CSV. Returns false when the browser could not start the download. */
export function downloadWordCsv(list: SavedWordList) {
  return downloadText(wordFilename(list.name, "csv"), encodeWordCsv(list.words), CSV_MIME_TYPE)
}

/** Downloads a pack's file as `<name>.typle-pack.json`, the name made safe as a CSV's is. Returns false when the browser could not start the download. */
export function downloadPackFile(name: string, text: string) {
  return downloadText(wordFilename(name, "typle-pack.json"), text, "application/json;charset=utf-8")
}

function downloadText(filename: string, text: string, type: string) {
  let url: string | undefined
  const link = document.createElement("a")
  try {
    url = URL.createObjectURL(new Blob([text], { type }))
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    return true
  } catch { return false }
  finally {
    link.remove()
    // Give the browser time to start consuming the download before releasing it.
    if (url) { const downloadUrl = url; window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000) }
  }
}

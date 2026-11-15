"use client"
import { useStoredChoice } from '@/lib/useStoredChoice'

// Whether the practice screen shows its side panel (word lists and best records). Remembered per browser; shown by default.
export const PLAY_ASIDE_KEY = 'typle-r:play-aside'

const read = (text: string | null) => text !== 'collapsed'
const stored = (open: boolean) => open ? null : 'collapsed'

export function usePlayAsideOpen() {
  return useStoredChoice(PLAY_ASIDE_KEY, read, stored)
}

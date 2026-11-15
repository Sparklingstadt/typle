"use client"
import { useStoredChoice } from '@/lib/useStoredChoice'

// Whether the practice card shows the live elapsed time, speed, accuracy and mistakes. Remembered per browser; shown by default.
export const LIVE_STATS_KEY = 'typle-r:live-stats'

const read = (text: string | null) => text !== 'hidden'
const stored = (visible: boolean) => visible ? null : 'hidden'

export function useLiveStatsVisible() {
  return useStoredChoice(LIVE_STATS_KEY, read, stored)
}

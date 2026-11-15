"use client"
import type { PracticeMode } from '@/core/records'
import { useStoredChoice } from '@/lib/useStoredChoice'

// How the practice screen asks for the words: normal shows the answer, recall hides it. Remembered per browser and
// synced across tabs; only `recall` is written, so normal is the default.
export const PRACTICE_MODE_KEY = 'typle-r:practice-mode'

const modeOf = (value: string | null): PracticeMode => value === 'recall' ? 'recall' : 'normal'
const stored = (mode: PracticeMode) => mode === 'recall' ? 'recall' : null

// The setter returns whether the choice was remembered; the mode still changes for this page when browser storage is
// unavailable.
export function usePracticeMode(): readonly [PracticeMode, (mode: PracticeMode) => boolean] {
  return useStoredChoice(PRACTICE_MODE_KEY, modeOf, stored)
}

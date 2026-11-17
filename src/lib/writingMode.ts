"use client"
import { useStoredChoice } from '@/hooks/useStoredChoice'

// Whether a list marked for writing is practised by typing or by handwriting. Remembered per browser; typing by default,
// and only `writing` is written (as the recall switch does in practiceMode.ts).
export const WRITING_MODE_KEY = 'typle-r:writing-mode'

export type WritingChoice = 'normal' | 'writing'

const readMode = (text: string | null): WritingChoice => text === 'writing' ? 'writing' : 'normal'
const storedMode = (mode: WritingChoice) => mode === 'writing' ? 'writing' : null

// Not synced across tabs, as before.
export function useWritingMode() {
  return useStoredChoice(WRITING_MODE_KEY, readMode, storedMode, false)
}

// A list without the mark is always typed, whatever was chosen before.
export function practiceMode(list: { writing?: unknown } | undefined, preferred: WritingChoice): WritingChoice {
  return list?.writing && preferred === 'writing' ? 'writing' : 'normal'
}

// How handwriting reaches the app for languages it reads itself (hasHandwritingModel): the in-app handwriting pad, or a
// text field for the OS's handwriting input. Remembered per browser; the pad by default, and only `field` is written.
export const WRITING_INPUT_KEY = 'typle-r:writing-input'

export type WritingInput = 'pad' | 'field'

const readInput = (text: string | null): WritingInput => text === 'field' ? 'field' : 'pad'
const storedInput = (input: WritingInput) => input === 'field' ? 'field' : null

export function useWritingInput() {
  return useStoredChoice(WRITING_INPUT_KEY, readInput, storedInput, false)
}

// The sign-in page's decoration: words that type themselves, one character a step.

export type DemoWord = { input: string; meaning: string }

/** Milliseconds between two typed characters. */
export const STEP_MS = 160

/** Steps a finished word stays on screen before the next one starts. */
export const HOLD_STEPS = 6

/** Steps one word takes: nothing typed to all of it, then held. */
const wordSteps = (word: DemoWord) => Array.from(word.input).length + 1 + HOLD_STEPS

/** The word on screen at `step` and how much of it is typed; after the last word the first comes again. */
export function demoFrame(words: DemoWord[], step: number): { word: DemoWord; typed: string } {
  const total = words.reduce((sum, word) => sum + wordSteps(word), 0)
  let rest = step % total
  for (const word of words) {
    const steps = wordSteps(word)
    if (rest < steps) {
      const characters = Array.from(word.input)
      return { word, typed: characters.slice(0, Math.min(rest, characters.length)).join('') }
    }
    rest -= steps
  }
  throw new Error('unreachable')
}

/** The step shown before anything moves, and kept with reduced motion: the first word two thirds typed. */
export function stillStep(words: DemoWord[]): number {
  return Math.ceil(Array.from(words[0].input).length * 2 / 3)
}

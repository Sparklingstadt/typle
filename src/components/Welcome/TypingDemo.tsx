"use client"
import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { compareInput } from '@/lib/typing'
import { demoProgress } from '@/lib/welcome'
import type { Word } from '@/lib/wordFormat'
import PracticeText from '@/components/Practice/PracticeText'
import TargetText from '@/components/Practice/TargetText'

const MS_PER_CHAR = 120
const PAUSE_MS = 1200

// The first word, drawn as in practice, typing itself over and over. Decoration only: hidden from screen readers.
// With reduced motion it shows the word fully typed and stays still.
export default function TypingDemo({ word }: { word: Word }) {
  const reduced = useReducedMotion()
  const length = Array.from(word.input).length
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (reduced) return
    const cycle = length * MS_PER_CHAR + PAUSE_MS
    const started = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      setElapsed((now - started) % cycle)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [reduced, length])
  const typed = reduced ? word.input : demoProgress(word.input, elapsed, MS_PER_CHAR)
  const comparison = compareInput(word.input, typed)
  const single = word.display === word.input || word.input_type === 'code'
  return <div aria-hidden="true" className="flex flex-col items-center gap-3 text-center">
    {single
      ? <TargetText {...comparison} />
      : <>
        <PracticeText text={word.display} />
        <TargetText {...comparison} guide />
      </>}
  </div>
}

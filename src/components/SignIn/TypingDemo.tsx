"use client"
import { useEffect, useState } from 'react'
import TargetText from '@/components/Practice/TargetText'
import { demoFrame, stillStep, STEP_MS, type DemoWord } from '@/lib/signinDemo'
import { compareInput } from '@/lib/typing'

// The sign-in page's decoration: a word types itself the way the practice screen draws it, then the next one.
// It is hidden from screen readers and takes no focus. With reduced motion it stays on one half-typed frame.
export default function TypingDemo({ words }: { words: DemoWord[] }) {
  // The server and the first client render show the same still frame; only the effect starts the motion.
  const [step, setStep] = useState(() => stillStep(words))

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => setStep(current => current + 1), STEP_MS)
    return () => clearInterval(timer)
  }, [])

  const { word, typed } = demoFrame(words, step)
  const { characters, states, extra } = compareInput(word.input, typed)
  return <div data-testid="typing-demo" aria-hidden="true" className="mb-6 max-w-sm space-y-1 rounded-2xl border bg-card px-6 py-5 text-center shadow-xs">
    <TargetText characters={characters} states={states} extra={extra} className="text-[32px] leading-tight sm:text-[40px]" />
    <p className="text-sm text-muted-foreground">{word.meaning}</p>
  </div>
}

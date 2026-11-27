"use client"
import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'

const MS_PER_CHAR = 40
const MAX_MS = 1000

// A heading that types itself in, with a blinking caret. Screen readers get the whole text at once; with reduced
// motion everyone does.
export default function TypedHeading({ id, text }: { id: string, text: string }) {
  const reduced = useReducedMotion()
  const characters = Array.from(text)
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (reduced) return
    const step = Math.min(MS_PER_CHAR, MAX_MS / Math.max(characters.length, 1))
    const started = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const count = Math.min(characters.length, Math.floor((now - started) / step) + 1)
      setShown(count)
      if (count < characters.length) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [reduced, characters.length, text])
  const visible = reduced ? characters.length : shown
  return <h2 id={id} tabIndex={-1} className="text-2xl font-bold outline-none sm:text-[28px]">
    <span className="sr-only">{text}</span>
    <span aria-hidden="true">
      {characters.slice(0, visible).join('')}
      <span className="invisible">{characters.slice(visible).join('')}</span>
      <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] bg-primary motion-safe:animate-pulse" />
    </span>
  </h2>
}

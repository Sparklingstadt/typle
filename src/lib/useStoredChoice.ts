"use client"
import { useCallback, useEffect, useState } from 'react'

/**
 * A choice remembered per browser under `key`. `read` turns the stored text (null when nothing is stored) into the
 * choice; `stored` turns a choice into the text to store, or null for the default, which removes the key so that a
 * browser that never chose has nothing stored. With `sync`, a choice made in another tab is followed here. Both
 * functions must be stable (defined outside the component).
 *
 * `choose` returns whether the choice was remembered: the choice still holds for this page when browser storage is
 * unavailable.
 */
export function useStoredChoice<T>(key: string, read: (text: string | null) => T, stored: (choice: T) => string | null, sync = true) {
  const [choice, setChoice] = useState<T>(() => {
    try { return read(localStorage.getItem(key)) } catch { return read(null) }
  })
  useEffect(() => {
    if (!sync) return
    function changed(event: StorageEvent) {
      if (event.key === key || event.key === null) setChoice(read(event.newValue))
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [key, read, sync])
  const choose = useCallback((next: T) => {
    setChoice(next)
    try {
      const text = stored(next)
      if (text === null) localStorage.removeItem(key)
      else localStorage.setItem(key, text)
      return true
    } catch { return false }
  }, [key, stored])
  return [choice, choose] as const
}

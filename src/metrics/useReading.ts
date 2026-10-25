import { useEffect, useRef, useState } from 'react'
import type { CandidateProfile } from '../shared/profile.ts'
import { usage, type Usage } from './usage.ts'

// How long a profile has been on screen, for the reading counts (reading.ts).
// The clock runs once a second while the tab is visible, and starts again at
// zero for each profile, so time on one never counts toward the next. Sample
// profiles are never counted: they are someone else's words.

/**
 * Reports the profile's visible seconds, and whether its Sources list has
 * come into view, to the counter. `races` lists every candidate's profile
 * key for each race the profile is in (undefined while those load). Returns
 * a ref callback for the element around the Sources list.
 */
export function useProfileReading(
  profile: CandidateProfile | undefined,
  races: string[][] | undefined,
  counter: Usage = usage,
): (el: HTMLElement | null) => void {
  const [sources, setSources] = useState<HTMLElement | null>(null)
  const counted = profile && !profile.sample ? profile : undefined
  const key = counted?.key
  const kind = counted?.kind
  // This profile's clock, read by the timer and the Sources observer alike.
  const clock = useRef({ secs: 0, seen: false })
  const latestRaces = useRef(races)
  useEffect(() => {
    latestRaces.current = races
  }, [races])

  useEffect(() => {
    if (!key || !kind) return
    clock.current = { secs: 0, seen: false }
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      clock.current.secs += 1
      const { secs, seen } = clock.current
      counter.reading({ key, kind }, secs, seen, latestRaces.current)
    }, 1000)
    return () => clearInterval(timer)
  }, [key, kind, counter])

  useEffect(() => {
    if (!key || !kind || !sources) return
    if (typeof IntersectionObserver === 'undefined') return
    // Watched again for each profile: the panel beside the ballot keeps the
    // same Sources element when the voter opens another candidate.
    const observer = new IntersectionObserver((entries) => {
      if (clock.current.seen || !entries.some((e) => e.isIntersecting)) return
      clock.current.seen = true
      const { secs } = clock.current
      counter.reading({ key, kind }, secs, true, latestRaces.current)
    })
    observer.observe(sources)
    return () => observer.disconnect()
  }, [key, kind, sources, counter])

  return setSources
}

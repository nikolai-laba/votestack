// Unique devices per day, week, month and election, and a device's first
// arrival (see src/shared/metrics.ts). The note is kept in localStorage as a
// few plain fields: the last day, week, month and election this device was
// counted in, and the entry page type and source category of its first
// visit. No identifier, and nothing in it is ever sent except as counts.
// Every storage call is wrapped, with an in-memory copy as the fallback, so
// blocked storage means the device is counted for the page load only.

import {
  USAGE_ELECTION,
  mondayOf,
  type DevicePeriod,
  type UsageEvent,
  type UsagePage,
  type VisitSource,
} from '../shared/metrics.ts'

export const SEEN_KEY = 'votestack:usage:seen:v1'

interface FirstArrival {
  /** Millisecond time that visit started. */
  started: number
  entry: UsagePage
  source: VisitSource
}

interface SeenNote {
  day: string
  week: string
  month: string
  election: string
  /** 'unknown' for devices counted before first arrivals were kept. */
  first: FirstArrival | 'unknown'
  /** True once this device's lookup has been sent as an origin. */
  credited?: boolean
}

export interface DeviceDeps {
  storage: () => Storage | null
  /** Local YYYY-MM-DD. */
  today: () => string
  add: (e: UsageEvent) => void
  /** True when VoteStack's other notes exist on this device already. */
  hadOlderNotes: () => boolean
}

export interface Devices {
  /** Call on the first counted page of each page load. */
  counted: (visit: {
    started: number
    entry: UsagePage
    source: VisitSource
  }) => void
  /** Call on a device's first own-ballot lookup. */
  origin: (visitStarted: number) => void
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

const isNote = (v: unknown): v is SeenNote => {
  const o = v as SeenNote | null
  return (
    !!o &&
    typeof o.day === 'string' &&
    typeof o.week === 'string' &&
    typeof o.month === 'string' &&
    typeof o.election === 'string' &&
    (o.first === 'unknown' ||
      (!!o.first &&
        typeof o.first.started === 'number' &&
        typeof o.first.entry === 'string' &&
        typeof o.first.source === 'string'))
  )
}

export function createDevices(
  deps: DeviceDeps = {
    storage: defaultStorage,
    today: () => '',
    add: () => {},
    hadOlderNotes: () => false,
  },
): Devices {
  // Copy kept in memory, used whenever storage can't be read or written.
  let memory: SeenNote | null = null
  let done = false

  function load(): SeenNote | null {
    try {
      const raw = deps.storage()?.getItem(SEEN_KEY)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (isNote(parsed)) return parsed
      }
    } catch {
      // unreadable: fall back to the copy in memory
    }
    return memory
  }

  function save(note: SeenNote) {
    memory = note
    try {
      deps.storage()?.setItem(SEEN_KEY, JSON.stringify(note))
    } catch {
      // the copy in memory carries the note for this page load
    }
  }

  return {
    counted(visit) {
      if (done) return
      done = true
      const old = load()
      const day = deps.today()
      const now: Record<DevicePeriod, string> = {
        day,
        week: mondayOf(day),
        month: day.slice(0, 7),
        election: USAGE_ELECTION,
      }
      // Only the very first count is 'new', and not for older devices.
      const seen = old || deps.hadOlderNotes() ? 'back' : 'new'
      for (const period of ['day', 'week', 'month', 'election'] as const) {
        if (old?.[period] === now[period]) continue
        deps.add({ e: 'device', period, seen })
      }
      save({
        ...now,
        first:
          old?.first ??
          (deps.hadOlderNotes()
            ? 'unknown'
            : {
                started: visit.started,
                entry: visit.entry,
                source: visit.source,
              }),
        ...(old?.credited ? { credited: true } : {}),
      })
    },
    origin(visitStarted) {
      const note = load()
      if (!note || note.credited) return
      const first = note.first
      deps.add({
        e: 'origin',
        entry: first === 'unknown' ? 'unknown' : first.entry,
        source: first === 'unknown' ? 'unknown' : first.source,
        when:
          first !== 'unknown' && first.started === visitStarted
            ? 'same'
            : 'later',
      })
      save({ ...note, credited: true })
    },
  }
}

// Profiles a device has read, and the races it is informed on (see
// src/shared/metrics.ts). The note is kept in localStorage: each profile key
// with the marks already sent, the most recently read keys last, plus the
// last week and the election this device was counted informed in. Only
// public profile keys are kept, and nothing in it is sent except as counts.
// Every storage call is wrapped, with an in-memory copy as the fallback, so
// blocked storage means reads are remembered for the page load only.

import {
  MAX_READ_PROFILES,
  READ_MARKS,
  READ_RULE,
  USAGE_ELECTION,
  mondayOf,
  type ReadMark,
  type UsageEvent,
  type VisitPath,
  type VisitStep,
} from '../shared/metrics.ts'

export const READS_KEY = 'votestack:usage:reads:v1'

export interface ReadProfile {
  key: string
  kind: 'candidate' | 'judicial_candidate' | 'retention'
}

interface ReadsNote {
  profiles: Record<string, ReadMark[]>
  /** Profile keys, least recently read first. */
  order: string[]
  week?: string
  election?: string
}

export interface ReadingDeps {
  storage: () => Storage | null
  /** Local YYYY-MM-DD. */
  today: () => string
  add: (e: UsageEvent) => void
  path: () => VisitPath
  step: (s: VisitStep) => void
}

export interface Reading {
  /**
   * Call as a profile's visible time grows. `races` lists, for each race the
   * profile belongs to, every candidate's profile key (this one included).
   */
  progress: (
    profile: ReadProfile,
    secs: number,
    sourcesSeen: boolean,
    races: string[][] | undefined,
  ) => void
}

const isNote = (v: unknown): v is ReadsNote => {
  const o = v as ReadsNote | null
  return (
    !!o &&
    !!o.profiles &&
    typeof o.profiles === 'object' &&
    !Array.isArray(o.profiles) &&
    Object.values(o.profiles).every(Array.isArray) &&
    Array.isArray(o.order) &&
    o.order.every((k) => typeof k === 'string') &&
    (o.week === undefined || typeof o.week === 'string') &&
    (o.election === undefined || typeof o.election === 'string')
  )
}

export function createReading(deps: ReadingDeps): Reading {
  // Copy kept in memory, used whenever storage can't be read or written.
  let memory: ReadsNote | null = null

  function load(): ReadsNote {
    try {
      const raw = deps.storage()?.getItem(READS_KEY)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (isNote(parsed)) return parsed
      }
    } catch {
      // unreadable: fall back to the copy in memory
    }
    return memory ?? { profiles: {}, order: [] }
  }

  function save(note: ReadsNote) {
    memory = note
    try {
      deps.storage()?.setItem(READS_KEY, JSON.stringify(note))
    } catch {
      // the copy in memory carries the note for this page load
    }
  }

  // Only a profile that met the read rule counts toward informed.
  const has = (note: ReadsNote, key: string) =>
    note.profiles[key]?.includes('read') ?? false

  /** The kind of the first informed race, or null when none is. */
  function informedKind(
    note: ReadsNote,
    races: string[][],
  ): 'single' | 'compared' | null {
    for (const race of races) {
      if (race.length === 1 && has(note, race[0])) return 'single'
      if (race.length >= 2 && race.filter((k) => has(note, k)).length >= 2)
        return 'compared'
    }
    return null
  }

  return {
    progress(profile, secs, sourcesSeen, races) {
      const note = load()
      let changed = false
      const old = note.profiles[profile.key] ?? []
      const sent = [...old]
      const kind =
        profile.kind === 'judicial_candidate' ? 'judicial' : profile.kind
      const send = (mark: ReadMark) => {
        if (sent.includes(mark)) return
        sent.push(mark)
        deps.add({ e: 'read', path: deps.path(), kind, mark })
        if (mark === 'read') deps.step('read')
      }
      for (const t of READ_MARKS) {
        if (secs >= t) send(String(t) as ReadMark)
      }
      if (sourcesSeen) send('sources')
      if (
        secs >= READ_RULE.secs ||
        (sourcesSeen && secs >= READ_RULE.sourcesAfter)
      )
        send('read')

      if (sent.length > old.length) {
        // Reading moves a profile to the recent end, and the oldest goes first.
        changed = true
        note.profiles[profile.key] = sent
        note.order = [
          ...note.order.filter((k) => k !== profile.key),
          profile.key,
        ]
        while (note.order.length > MAX_READ_PROFILES) {
          delete note.profiles[note.order.shift() as string]
        }
      }

      const kindOfRace = races ? informedKind(note, races) : null
      if (kindOfRace) {
        deps.step('informed')
        const week = mondayOf(deps.today())
        const path = deps.path()
        if (note.election !== USAGE_ELECTION) {
          changed = true
          note.election = USAGE_ELECTION
          deps.add({
            e: 'informed',
            period: 'election',
            path,
            kind: kindOfRace,
          })
        }
        if (note.week !== week) {
          changed = true
          note.week = week
          deps.add({ e: 'informed', period: 'week', path, kind: kindOfRace })
        }
      }
      if (changed) save(note)
    },
  }
}

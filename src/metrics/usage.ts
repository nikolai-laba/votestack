// Anonymous usage counts from the app (rules in src/shared/metrics.ts).
// Events wait in a short queue and go to POST /api/event in one request when
// the page is hidden or closed, or once the queue fills.
//
// To count each device once per election without an identifier, the device
// keeps a small record in its own localStorage key: the days it was first and
// last counted, which races had a profile opened (up to two candidates each)
// and which races were counted as picked. It never leaves the device; the
// Worker only receives the events built from it. Every storage call is
// wrapped, so blocked storage means counts last for the page only.

import { sectionFor } from '../ballot/sections.ts'
import { contestsWithPerson } from '../ballot/profileLinks.ts'
import type { SavedBallot, Picks } from '../picks/store.ts'
import type { Contest } from '../shared/ballot.ts'
import {
  MAX_EVENTS,
  USAGE_LEVELS,
  isAutomatedAgent,
  type UsageEvent,
  type UsageLevel,
  type UsagePage,
  type ViewSource,
} from '../shared/metrics.ts'
import { regionForElection } from '../shared/regions.ts'

export const USAGE_KEY = 'votestack:usage:v1'
export const EVENT_URL = '/api/event'

/** What the device remembers about one election. */
interface ElectionRecord {
  /** Day first counted (YYYY-MM-DD, local time). */
  first: string
  /** Day last counted. */
  last: string
  /** Contest id → profile keys opened in it (at most two). */
  opened: Record<string, string[]>
  /** Contests already counted as picked. */
  picked: string[]
  half?: boolean
}

type DeviceRecord = Record<string, ElectionRecord>

export interface UsageDeps {
  storage: () => Storage | null
  /** Sends a batch; false if it couldn't be handed over. */
  send: (events: UsageEvent[]) => boolean
  /** Today's date as YYYY-MM-DD. */
  today: () => string
  /** Seconds since the page opened. */
  clock: () => number
}

function localToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function beacon(events: UsageEvent[]): boolean {
  const body = JSON.stringify({ events })
  try {
    if (navigator.sendBeacon)
      return navigator.sendBeacon(
        EVENT_URL,
        new Blob([body], { type: 'application/json' }),
      )
    void fetch(EVENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
    return true
  } catch {
    return false
  }
}

const levelOf = (contest: Contest): UsageLevel => {
  const level = sectionFor(contest)
  return (USAGE_LEVELS as readonly string[]).includes(level)
    ? (level as UsageLevel)
    : 'local'
}

/** Races that count toward "half the ballot": judges and retention left out. */
const countsForHalf = (contest: Contest) => {
  const level = levelOf(contest)
  return level !== 'judges' && level !== 'retention'
}

const regionOf = (ballot: SavedBallot) =>
  regionForElection(ballot.election.id)?.id ?? 'none'

export function createUsage(deps: UsageDeps) {
  let queue: UsageEvent[] = []
  let memory: DeviceRecord = {}
  /** False once a write fails: the page then keeps its own copy only. */
  let storageWorks = true
  /** Elections already counted on this page, so a re-render never counts twice. */
  const countedHere = new Set<string>()

  function read(): DeviceRecord {
    const storage = storageWorks ? deps.storage() : null
    if (!storage) return memory
    try {
      const raw = storage.getItem(USAGE_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      memory =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as DeviceRecord)
          : {}
    } catch {
      // Unreadable: keep what this page knows.
    }
    return memory
  }

  function write(record: DeviceRecord) {
    memory = record
    try {
      deps.storage()?.setItem(USAGE_KEY, JSON.stringify(record))
    } catch {
      // Blocked or full: counts last for this page only.
      storageWorks = false
    }
  }

  function election(id: string): ElectionRecord | undefined {
    const r = read()[id]
    if (!r || typeof r !== 'object') return undefined
    return {
      first: String(r.first),
      last: String(r.last),
      opened: r.opened && typeof r.opened === 'object' ? r.opened : {},
      picked: Array.isArray(r.picked) ? r.picked : [],
      half: r.half === true,
    }
  }

  function save(id: string, r: ElectionRecord) {
    write({ ...read(), [id]: r })
  }

  function add(event: UsageEvent) {
    queue.push(event)
    if (queue.length >= MAX_EVENTS) flush()
  }

  function flush() {
    if (!queue.length) return
    const batch = queue.slice(0, MAX_EVENTS)
    if (deps.send(batch)) queue = queue.slice(batch.length)
    else queue = []
  }

  return {
    flush,
    /** Events waiting to be sent (tests). */
    pending: () => [...queue],

    view(page: UsagePage, from: ViewSource, key?: string) {
      add(key ? { e: 'view', page, from, key } : { e: 'view', page, from })
    },

    /**
     * The voter's own ballot is on screen: counts the device once per
     * election ('new'), then once on each later day ('return').
     * `secsToBallot` is given for a lookup made on this page.
     */
    voter(ballot: SavedBallot, secsToBallot?: number) {
      const id = ballot.election.id
      const record = election(id)
      // Already counted on this page (and the device still has its record).
      if (countedHere.has(id) && record) return
      countedHere.add(id)
      const today = deps.today()
      const region = regionOf(ballot)
      if (!record) {
        const races: Partial<Record<UsageLevel, number>> = {}
        for (const c of ballot.contests) {
          const level = levelOf(c)
          races[level] = (races[level] ?? 0) + 1
        }
        add({
          e: 'voter',
          kind: 'new',
          region,
          races,
          ...(secsToBallot === undefined ? {} : { secs: secsToBallot }),
        })
        save(id, { first: today, last: today, opened: {}, picked: [] })
        return
      }
      if (record.last !== today) {
        add({ e: 'voter', kind: 'return', region })
        save(id, { ...record, last: today })
      }
    },

    /** A profile opened while the voter's own ballot is shown. */
    open(ballot: SavedBallot, key: string) {
      const id = ballot.election.id
      const record = election(id)
      if (!record) return
      const opened = { ...record.opened }
      for (const contest of contestsWithPerson(ballot.contests, key)) {
        const keys = opened[contest.id] ?? []
        if (keys.includes(key) || keys.length >= 2) continue
        opened[contest.id] = [...keys, key]
        add({
          e: 'open',
          level: levelOf(contest),
          nth: keys.length === 0 ? 1 : 2,
        })
      }
      save(id, { ...record, opened })
    },

    /**
     * Picks changed: counts each race's first pick, then the moment half
     * the ballot (judges left out) is picked. Races picked before
     * `baseline` (the picks when the page opened) are never counted, so
     * picks made before counting began don't arrive all at once.
     */
    picks(ballot: SavedBallot, picks: Picks, baseline: Picks) {
      const id = ballot.election.id
      const record = election(id)
      if (!record) return
      const now = picks[id] ?? {}
      const before = baseline[id] ?? {}
      const counted = new Set(record.picked)
      let changed = false
      for (const contest of ballot.contests) {
        if (!now[contest.id]?.length || counted.has(contest.id)) continue
        counted.add(contest.id)
        changed = true
        if (before[contest.id]?.length) continue
        add({
          e: 'pick',
          level: levelOf(contest),
          informed: Boolean(record.opened[contest.id]?.length),
        })
      }
      const half = ballot.contests.filter(countsForHalf)
      const picked = half.filter((c) => now[c.id]?.length)
      const reached = half.length > 0 && picked.length * 2 >= half.length
      if (reached && !record.half) {
        const informed = picked.filter((c) => record.opened[c.id]?.length)
        add({
          e: 'half',
          region: regionOf(ballot),
          informed: informed.length * 2 > picked.length,
        })
      }
      if (changed || (reached && !record.half))
        save(id, {
          ...record,
          picked: [...counted],
          half: record.half || reached,
        })
    },

    out(page: UsagePage) {
      add({ e: 'out', page })
    },

    active(secs: number, hasBallot: boolean) {
      if (secs >= 1) add({ e: 'active', secs, ballot: hasBallot })
    },

    clock: deps.clock,
  }
}

export type Usage = ReturnType<typeof createUsage>

/**
 * The app's counter. Under tests (and when the page can't send) it only
 * queues, so nothing leaves a test run.
 */
export const usage = createUsage({
  storage: defaultStorage,
  // Automated browsers (crawlers, test tools) send nothing; the Worker also
  // drops crawlers that don't say they're automated here.
  send:
    import.meta.env.MODE === 'test' ||
    typeof navigator === 'undefined' ||
    navigator.webdriver ||
    isAutomatedAgent(navigator.userAgent)
      ? () => false
      : beacon,
  today: localToday,
  clock: () =>
    typeof performance === 'undefined' ? 0 : performance.now() / 1000,
})

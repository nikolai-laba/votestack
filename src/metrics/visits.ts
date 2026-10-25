// One browser-tab visit, and the steps it reaches (see src/shared/metrics.ts).
// A visit starts with the first page counted and ends after 30 minutes with
// no page shown and no step reached. It is kept in sessionStorage as a few
// plain fields: no identifier, and nothing in it is ever sent. Each step goes
// out once per visit, when it is first reached. Every storage call is
// wrapped, with an in-memory copy as the fallback, so blocked storage means
// the visit lasts for the page load only.

import {
  VISIT_TIMEOUT_MS,
  pathOf,
  visitSource,
  type UsageEvent,
  type UsagePage,
  type VisitPath,
  type VisitSource,
  type VisitStep,
} from '../shared/metrics.ts'

export const VISIT_KEY = 'votestack:usage:visit:v1'

interface StoredVisit {
  /** Millisecond time the visit started. */
  started: number
  /** Millisecond time of the last page shown or step reached. */
  last: number
  entry: UsagePage
  source: VisitSource
  /** Steps already sent. */
  steps: VisitStep[]
}

export interface VisitDeps {
  session: () => Storage | null
  /** Milliseconds, like Date.now(). */
  now: () => number
  referrer: () => string
  /** The site's bare hostname, no port. */
  host: () => string
  add: (e: UsageEvent) => void
}

export interface Visits {
  /** Call once per counted page view. */
  shown: (page: UsagePage) => void
  step: (step: VisitStep) => void
  current: () => {
    started: number
    entry: UsagePage
    source: VisitSource
    path: VisitPath
  } | null
  /** True when the current visit began on this page load. */
  isNew: () => boolean
}

function defaultSession(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

const isVisit = (v: unknown): v is StoredVisit => {
  const o = v as StoredVisit | null
  return (
    !!o &&
    typeof o.started === 'number' &&
    typeof o.last === 'number' &&
    typeof o.entry === 'string' &&
    typeof o.source === 'string' &&
    Array.isArray(o.steps)
  )
}

export function createVisits(
  deps: VisitDeps = {
    session: defaultSession,
    now: Date.now,
    referrer: () => (typeof document === 'undefined' ? '' : document.referrer),
    host: () => (typeof location === 'undefined' ? '' : location.hostname),
    add: () => {},
  },
): Visits {
  // Copy kept in memory, used whenever storage can't be read or written.
  let memory: StoredVisit | null = null
  let startedHere = false

  function load(): StoredVisit | null {
    let found: StoredVisit | null = null
    try {
      const raw = deps.session()?.getItem(VISIT_KEY)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (isVisit(parsed)) found = parsed
      }
    } catch {
      // unreadable: fall back to the copy in memory
    }
    const visit = found ?? memory
    if (!visit || deps.now() - visit.last > VISIT_TIMEOUT_MS) return null
    return visit
  }

  function save(visit: StoredVisit) {
    memory = visit
    try {
      deps.session()?.setItem(VISIT_KEY, JSON.stringify(visit))
    } catch {
      // the copy in memory carries the visit for this page load
    }
  }

  /** Marks a step reached; sends it only the first time in this visit. */
  function reach(visit: StoredVisit, step: VisitStep) {
    if (visit.steps.includes(step)) return
    visit.steps.push(step)
    deps.add({
      e: 'visit',
      entry: visit.entry,
      source: visit.source,
      step,
    })
  }

  return {
    shown(page) {
      let visit = load()
      if (!visit) {
        const now = deps.now()
        visit = {
          started: now,
          last: now,
          entry: page,
          source: visitSource(deps.referrer(), deps.host()),
          steps: [],
        }
        startedHere = true
        reach(visit, 'arrived')
      } else {
        visit.last = deps.now()
        reach(visit, 'browsed')
      }
      save(visit)
    },
    step(step) {
      const visit = load()
      if (!visit) return
      visit.last = deps.now()
      reach(visit, step)
      save(visit)
    },
    current() {
      const visit = load()
      if (!visit) return null
      return {
        started: visit.started,
        entry: visit.entry,
        source: visit.source,
        path: pathOf(visit.entry),
      }
    },
    isNew: () => startedHere && load() !== null,
  }
}

// Anonymous usage counts. The app (src/metrics/) sends small events to the
// Worker (POST /api/event, worker/events.ts), which checks each one against
// these rules and adds it to Cloudflare Workers Analytics Engine; a daily job
// copies the hourly totals to Supabase (worker/rollup.ts). Only what is
// listed here is ever counted: the page, the level of government, a yes/no
// flag, a number of seconds. Never an address, an IP address, a pick, which
// candidate was picked, or anything that tells one visitor from another.
// Pages are counted by their public address (a candidate's or race's page).

/** The ballot's levels of government (src/ballot/sections.ts). */
export const USAGE_LEVELS = [
  'federal',
  'state',
  'county',
  'judges',
  'local',
  'retention',
  'measures',
] as const
export type UsageLevel = (typeof USAGE_LEVELS)[number]

export const USAGE_PAGES = [
  'ballot',
  'start',
  'profile',
  'report',
  'saved',
  'races',
  'how',
  'about',
  'notify',
  'other',
] as const
export type UsagePage = (typeof USAGE_PAGES)[number]

/** How the visitor reached a page: the first page they opened, a row in a ballot or race list, or another link in the app. */
export type ViewSource = 'landing' | 'ballot' | 'app'

export type UsageEvent =
  /** A page shown. `key` is a candidate's profile key or a race's path: public names only. */
  | { e: 'view'; page: UsagePage; from: ViewSource; key?: string }
  /**
   * A device seen for an election: 'new' the first time (a ballot looked
   * up), 'return' once on each later day it comes back. `secs` is the time
   * from opening the site to the ballot; `races` counts the ballot's races
   * by level, so shares of races can be worked out from the totals.
   */
  | {
      e: 'voter'
      kind: 'new' | 'return'
      region: string
      secs?: number
      races?: Partial<Record<UsageLevel, number>>
    }
  /** A profile opened from the voter's own ballot: the first (nth 1) or a second candidate (nth 2) in one race. */
  | { e: 'open'; level: UsageLevel; nth: 1 | 2 }
  /** The first pick in a race; `informed` when a profile in that race was opened first. */
  | { e: 'pick'; level: UsageLevel; informed: boolean }
  /** Half the ballot's races (judges left out) picked; `informed` when most of them had a profile opened. */
  | { e: 'half'; region: string; informed: boolean }
  /** A link out of the site (a source, an official page), counted by the page it was on. */
  | { e: 'out'; page: UsagePage }
  /** Seconds the site was on screen since the last count. */
  | { e: 'active'; secs: number; ballot: boolean }

/** Counted by the Worker itself on each POST /api/ballot. */
export type LookupOutcome =
  'ok' | 'gaps' | 'not_found' | 'invalid' | 'rate_limited' | 'error'

/**
 * One row as stored: `blobs` are [event, a, b, c] (labels) and `doubles`
 * are numbers to add up. The rollup groups by hour and the four labels.
 */
export interface UsagePoint {
  blobs: [string, string, string, string]
  doubles: number[]
}

/** Events in one POST /api/event; more are dropped. */
export const MAX_EVENTS = 50

const REGION = /^[a-z]{2}-[a-z-]{1,30}$/
const KEY = /^[a-z0-9][a-z0-9/-]{0,119}$/
/** Longest stretch one count may cover: a day. */
const MAX_SECS = 86_400
const MAX_RACES = 1_000

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v)

const region = (v: unknown) =>
  typeof v === 'string' && REGION.test(v) ? v : 'none'

/** A whole number from 0 up to max (larger values are capped), or null. */
function bounded(v: unknown, max = MAX_SECS): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
  return Math.min(Math.round(v), max)
}

const point = (
  event: string,
  a = '',
  b = '',
  c = '',
  doubles: number[] = [],
): UsagePoint => ({ blobs: [event, a, b, c], doubles })

/**
 * The row to store for an event from the app, or null when anything in it is
 * unknown or out of range. Fields not listed above are ignored, never stored.
 */
export function usagePoint(raw: unknown): UsagePoint | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  switch (v.e) {
    case 'view': {
      if (!isOneOf(USAGE_PAGES, v.page)) return null
      if (!isOneOf(['landing', 'ballot', 'app'] as const, v.from)) return null
      const key = typeof v.key === 'string' && KEY.test(v.key) ? v.key : ''
      return point('view', v.page, v.from, key)
    }
    case 'voter': {
      if (!isOneOf(['new', 'return'] as const, v.kind)) return null
      const races = (typeof v.races === 'object' && v.races) || {}
      const counts = USAGE_LEVELS.map(
        (level) =>
          bounded((races as Record<string, unknown>)[level], MAX_RACES) ?? 0,
      )
      return point('voter', v.kind, region(v.region), '', [
        bounded(v.secs) ?? 0,
        ...counts,
      ])
    }
    case 'open':
      if (!isOneOf(USAGE_LEVELS, v.level) || (v.nth !== 1 && v.nth !== 2))
        return null
      return point('open', v.level, String(v.nth))
    case 'pick':
      if (!isOneOf(USAGE_LEVELS, v.level) || typeof v.informed !== 'boolean')
        return null
      return point('pick', v.level, v.informed ? '1' : '0')
    case 'half':
      if (typeof v.informed !== 'boolean') return null
      return point('half', region(v.region), v.informed ? '1' : '0')
    case 'out':
      if (!isOneOf(USAGE_PAGES, v.page)) return null
      return point('out', v.page)
    case 'active': {
      const secs = bounded(v.secs)
      if (secs === null || typeof v.ballot !== 'boolean') return null
      return point('active', v.ballot ? '1' : '0', '', '', [secs])
    }
    default:
      return null
  }
}

/** The row for one ballot lookup, counted by the Worker. */
export function lookupPoint(
  outcome: LookupOutcome,
  regionId: string | undefined,
  sample: boolean,
  ms: number,
): UsagePoint {
  return point('lookup', outcome, region(regionId), sample ? '1' : '0', [
    Math.max(0, Math.round(ms)),
  ])
}

/** The page type of an address in the app, and its public key where it has one. */
export function usagePage(pathname: string): {
  page: UsagePage
  key?: string
} {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { page: 'ballot' }
  const profile = /^\/candidates\/([^/]+)(\/report)?$/.exec(path)
  if (profile)
    return { page: profile[2] ? 'report' : 'profile', key: profile[1] }
  if (path === '/races') return { page: 'races' }
  if (path.startsWith('/races/'))
    return { page: 'races', key: path.slice('/races/'.length) }
  const pages: Record<string, UsagePage> = {
    '/getstarted': 'start',
    '/saved-choices': 'saved',
    '/my-ballot': 'saved',
    '/how-profiles-are-made': 'how',
    '/about': 'about',
    '/notify': 'notify',
  }
  return { page: pages[path] ?? 'other' }
}

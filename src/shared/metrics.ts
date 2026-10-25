// Anonymous usage counts. The app (src/metrics/) sends small events to the
// Worker (POST /api/event, worker/events.ts), which checks each one against
// these rules and adds it to Cloudflare Workers Analytics Engine; a daily job
// copies the hourly totals to Supabase (worker/rollup.ts). Only what is
// listed here is ever counted: the page, the level of government, a yes/no
// flag, a number of seconds, the steps a visit reaches, a kind of site it came
// from, whether a device is new, and how long a profile was read. Never an address, an IP address, a pick, which
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
  'support',
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
  /**
   * A sample ballot shown ('seen', once per device per election), and a
   * device that saw one then looking up its own ballot ('own', once).
   */
  | { e: 'sample'; step: 'seen' | 'own'; region: string }
  /** A profile opened from the voter's own ballot: the first (nth 1) or a second candidate (nth 2) in one race. */
  | { e: 'open'; level: UsageLevel; nth: 1 | 2 }
  /** The first pick in a race; `informed` when a profile in that race was opened first. */
  | { e: 'pick'; level: UsageLevel; informed: boolean }
  /**
   * Half the ballot's races (judges left out) picked; `informed` when most
   * of them had a profile opened. No longer sent (replaced by fill and learn
   * on 2026-10-20); still accepted from pages opened before then.
   */
  | { e: 'half'; region: string; informed: boolean }
  /**
   * A share of the ballot's candidate races picked, judges, retention and
   * measures left out (FILL_MILESTONES), once each per device.
   */
  | { e: 'fill'; region: string; pct: FillMilestone }
  /**
   * A learning milestone, once each per device: `races` below federal with
   * a profile opened, `compared` races with a second candidate opened (both
   * at the counts in LEARN_MILESTONES), or `researched` (n 1) the first time
   * either reaches RESEARCHED.
   */
  | { e: 'learn'; region: string; kind: LearnKind; n: number }
  /** A link out of the site (a source, an official page), counted by the page it was on. */
  | { e: 'out'; page: UsagePage }
  /** Seconds the site was on screen since the last count. */
  | { e: 'active'; secs: number; ballot: boolean }
  /** The email sign-up banner: shown (once per visit) or closed. */
  | { e: 'banner'; act: 'shown' | 'closed' }
  /** A step a visit has reached, once each per visit (see VisitStep). */
  | { e: 'visit'; entry: UsagePage; source: VisitSource; step: VisitStep }
  /** A device seen in a day, week, month or election: 'new' the first time in that period, 'back' if it was seen in an earlier one. */
  | { e: 'device'; period: DevicePeriod; seen: 'new' | 'back' }
  /** A profile read, at each length of time reached (READ_MARKS), when its sources were opened, or when it counts as read. */
  | { e: 'read'; path: VisitPath; kind: ReadKind; mark: ReadMark }
  /** A device informed on a race, once per week and once per election; 'compared' when a second candidate was opened too. */
  | {
      e: 'informed'
      period: 'week' | 'election'
      path: VisitPath
      kind: 'single' | 'compared'
    }
  /** A click on a route from a profile or race page toward a ballot, by the page it was on. */
  | { e: 'cta'; link: CtaLink; page: UsagePage }
  /** How a device first arrived, counted when its own ballot is looked up (same visit or a later one). */
  | {
      e: 'origin'
      entry: UsagePage | 'unknown'
      source: VisitSource | 'unknown'
      when: 'same' | 'later'
    }

/** The kind of site a visit came from, never the site itself. */
export type VisitSource =
  'search' | 'ai' | 'social' | 'email' | 'other' | 'direct'
export type VisitStep =
  | 'arrived'
  | 'browsed'
  | 'read'
  | 'informed'
  | 'form'
  | 'asked'
  | 'lookup'
  | 'returned'
  | 'researched'
  | 'picked'
/** Where a visit started: the ballot, a profile or race page, or anywhere else. */
export type VisitPath = 'ballot' | 'reader' | 'other'
export type DevicePeriod = 'day' | 'week' | 'month' | 'election'
export type CtaLink = 'top' | 'mid' | 'back' | 'race' | 'form'
export type ReadKind = 'candidate' | 'judicial' | 'retention'
export type ReadMark = '10' | '20' | '30' | '60' | 'sources' | 'read'
/** Why the Worker left a batch of events out. */
export type DropReason = 'bot' | 'invalid' | 'limited'

/** A visit ends after this long with no page shown and no event sent. */
export const VISIT_TIMEOUT_MS = 30 * 60_000
/** A profile counts as read after `secs` seconds on screen, or once its sources are opened after `sourcesAfter`. */
export const READ_RULE = { secs: 20, sourcesAfter: 10 }
/** Seconds on a profile that are counted as marks. */
export const READ_MARKS = [10, 20, 30, 60]
/** Most profiles a device remembers having read. */
export const MAX_READ_PROFILES = 200
/** The election that "this election" counts refer to. */
export const USAGE_ELECTION = '2026-11-03'

export const FILL_MILESTONES = [25, 50, 75, 100] as const
export type FillMilestone = (typeof FILL_MILESTONES)[number]

export type LearnKind = 'races' | 'compared' | 'researched'
export const LEARN_MILESTONES: Record<LearnKind, readonly number[]> = {
  races: [1, 3, 5, 10],
  compared: [1, 3],
  researched: [1],
}
/** "Researched their ballot": profiles opened in this many races below federal, or this many races compared. */
export const RESEARCHED = { races: 3, compared: 1 } as const

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

/**
 * Crawlers, link previews and automated browsers, by their user agent. Search
 * crawlers run the app's JavaScript, so without this one sweep of the site
 * counts as hundreds of visits. Used only to decide whether to count; the
 * user agent is never stored.
 */
const AUTOMATED_AGENT =
  /\bbot\b|bot\/|bot[;)]|crawl|spider|slurp|headless|lighthouse|pagespeed|inspectiontool|googleother|mediapartners|bingpreview|facebookexternalhit|embedly|phantomjs|puppeteer|playwright|selenium|curl\/|wget\/|python-|httpclient|okhttp|go-http/i

export function isAutomatedAgent(userAgent: string | null | undefined) {
  return !userAgent || AUTOMATED_AGENT.test(userAgent)
}

// Referrer hosts by kind of site, matched on the host or any parent of it.
// Checked in this order, so gemini.google.com and mail.google.com are found
// before google.*.
const AI_HOSTS = [
  'chatgpt.com',
  'chat.openai.com',
  'perplexity.ai',
  'claude.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
  'you.com',
  'meta.ai',
]
const EMAIL_HOSTS = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'mail.yahoo.com',
  'mail.proton.me',
]
const SEARCH_HOSTS = [
  'bing.com',
  'duckduckgo.com',
  'search.yahoo.com',
  'yahoo.com',
  'ecosia.org',
  'search.brave.com',
  'startpage.com',
  'baidu.com',
  'kagi.com',
]
const SEARCH_LABELS = /(^|\.)(google|yandex)\./
const SOCIAL_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  't.co',
  'x.com',
  'twitter.com',
  'reddit.com',
  'linkedin.com',
  'lnkd.in',
  'threads.net',
  'bsky.app',
  'tiktok.com',
  'youtube.com',
  'nextdoor.com',
  'mastodon.social',
]

const hostIn = (hostname: string, list: readonly string[]) =>
  list.some((s) => hostname === s || hostname.endsWith('.' + s))

/**
 * The kind of site a visit came from, from its referrer. `host` is the
 * site's own host: a visit from within it counts as direct. The referrer
 * itself is never kept.
 */
export function visitSource(referrer: string, host: string): VisitSource {
  if (!referrer) return 'direct'
  let hostname: string
  try {
    hostname = new URL(referrer).hostname.toLowerCase()
  } catch {
    return 'direct'
  }
  if (!hostname || hostname === host || hostname.endsWith('.' + host))
    return 'direct'
  if (hostIn(hostname, AI_HOSTS)) return 'ai'
  if (hostIn(hostname, EMAIL_HOSTS)) return 'email'
  if (hostIn(hostname, SEARCH_HOSTS) || SEARCH_LABELS.test(hostname))
    return 'search'
  if (hostIn(hostname, SOCIAL_HOSTS)) return 'social'
  return 'other'
}

/** Which path a visit is on, from the page it started on. */
export function pathOf(page: UsagePage): VisitPath {
  if (page === 'ballot' || page === 'start') return 'ballot'
  if (page === 'profile' || page === 'races') return 'reader'
  return 'other'
}

/** The Monday of the week a day (YYYY-MM-DD) falls in, in the same format. */
export function mondayOf(day: string): string {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Events in one POST /api/event; more are dropped. */
export const MAX_EVENTS = 50

const REGION = /^[a-z]{2}-[a-z-]{1,30}$/
const KEY = /^[a-z0-9][a-z0-9/-]{0,119}$/
/** Longest stretch one count may cover: a day. */
const MAX_SECS = 86_400
/**
 * Longest time to the ballot that is counted as one: past this the site was
 * most likely left open before the lookup, so the time isn't added.
 */
export const MAX_SECS_TO_BALLOT = 1_800
const MAX_RACES = 1_000

const VISIT_SOURCES = [
  'search',
  'ai',
  'social',
  'email',
  'other',
  'direct',
] as const
const VISIT_STEPS = [
  'arrived',
  'browsed',
  'read',
  'informed',
  'form',
  'asked',
  'lookup',
  'returned',
  'researched',
  'picked',
] as const
const VISIT_PATHS = ['ballot', 'reader', 'other'] as const
const DEVICE_PERIODS = ['day', 'week', 'month', 'election'] as const
const CTA_LINKS = ['top', 'mid', 'back', 'race', 'form'] as const
const READ_KINDS = ['candidate', 'judicial', 'retention'] as const
const READ_MARK_LABELS = ['10', '20', '30', '60', 'sources', 'read'] as const

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
      // c says whether d1 holds a time: 'timed', 'restored' (the ballot was
      // already on the device) or 'long' (over MAX_SECS_TO_BALLOT, left out).
      const secs = bounded(v.secs)
      const timing =
        v.kind !== 'new'
          ? ''
          : secs === null
            ? 'restored'
            : secs > MAX_SECS_TO_BALLOT
              ? 'long'
              : 'timed'
      return point('voter', v.kind, region(v.region), timing, [
        timing === 'timed' ? (secs ?? 0) : 0,
        ...counts,
      ])
    }
    case 'sample':
      if (!isOneOf(['seen', 'own'] as const, v.step)) return null
      return point('sample', v.step, region(v.region))
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
    case 'fill':
      if (!(FILL_MILESTONES as readonly unknown[]).includes(v.pct)) return null
      return point('fill', String(v.pct), region(v.region))
    case 'learn': {
      if (!isOneOf(['races', 'compared', 'researched'] as const, v.kind))
        return null
      if (!LEARN_MILESTONES[v.kind].includes(v.n as number)) return null
      return point('learn', v.kind, region(v.region), String(v.n))
    }
    case 'out':
      if (!isOneOf(USAGE_PAGES, v.page)) return null
      return point('out', v.page)
    case 'active': {
      const secs = bounded(v.secs)
      if (secs === null || typeof v.ballot !== 'boolean') return null
      return point('active', v.ballot ? '1' : '0', '', '', [secs])
    }
    case 'banner':
      if (!isOneOf(['shown', 'closed'] as const, v.act)) return null
      return point('banner', v.act)
    case 'visit':
      if (!isOneOf(USAGE_PAGES, v.entry)) return null
      if (!isOneOf(VISIT_SOURCES, v.source)) return null
      if (!isOneOf(VISIT_STEPS, v.step)) return null
      return point('visit', v.entry, v.source, v.step)
    case 'device':
      if (!isOneOf(DEVICE_PERIODS, v.period)) return null
      if (!isOneOf(['new', 'back'] as const, v.seen)) return null
      return point('device', v.period, v.seen)
    case 'read':
      if (!isOneOf(VISIT_PATHS, v.path)) return null
      if (!isOneOf(READ_KINDS, v.kind)) return null
      if (!isOneOf(READ_MARK_LABELS, v.mark)) return null
      return point('read', v.path, v.kind, v.mark)
    case 'informed':
      if (!isOneOf(['week', 'election'] as const, v.period)) return null
      if (!isOneOf(VISIT_PATHS, v.path)) return null
      if (!isOneOf(['single', 'compared'] as const, v.kind)) return null
      return point('informed', v.period, v.path, v.kind)
    case 'cta':
      if (!isOneOf(CTA_LINKS, v.link) || !isOneOf(USAGE_PAGES, v.page))
        return null
      return point('cta', v.link, v.page)
    case 'origin':
      if (v.entry !== 'unknown' && !isOneOf(USAGE_PAGES, v.entry)) return null
      if (v.source !== 'unknown' && !isOneOf(VISIT_SOURCES, v.source))
        return null
      if (!isOneOf(['same', 'later'] as const, v.when)) return null
      return point('origin', v.entry, v.source, v.when)
    default:
      return null
  }
}

/** A batch the Worker left out, with how many events it held when that is known. */
export function droppedPoint(
  reason: DropReason,
  rejected?: number,
): UsagePoint {
  return point(
    'dropped',
    reason,
    '',
    '',
    rejected === undefined ? [] : [rejected],
  )
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
    '/support': 'support',
  }
  return { page: pages[path] ?? 'other' }
}

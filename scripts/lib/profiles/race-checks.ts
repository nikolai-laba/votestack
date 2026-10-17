// Checks that look past one profile's text: dates against today,
// equal coverage between opponents, and what each cited link returned.
// Pure functions; scripts/profiles/check.ts does the fetching.

import type { CandidateProfile } from '../../../src/shared/profile.ts'
import { countWords, isSocialMedia, type Issue } from './checks.ts'

/** How old a "viewed" date may be before the source must be read again. */
export const MAX_SOURCE_AGE_DAYS = 30

const DAY = 24 * 60 * 60 * 1000
const days = (from: string, to: string) =>
  Math.round(
    (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY,
  )

/** Dates are real, not in the future, and sources were viewed recently. */
export function checkDates(p: CandidateProfile, today: string): Issue[] {
  const issues: Issue[] = []
  const dated: [string, string][] = [
    ['overview.asOf', p.overview.asOf],
    ['money.asOf', p.money.asOf],
    ['endorsements.asOf', p.endorsements.asOf],
    ['meta.generatedAt', p.meta.generatedAt],
    ...p.sources.map((s, i): [string, string] => [
      `sources[${i}].viewedAt`,
      s.viewedAt,
    ]),
  ]
  for (const [at, date] of dated) {
    if (!date || Number.isNaN(Date.parse(date))) {
      issues.push({
        rule: 'date',
        severity: 'error',
        message: 'Not a date',
        at,
      })
    } else if (days(today, date) > (date.includes('T') ? 1 : 0)) {
      // A timestamp is in UTC, which runs up to a day ahead of the local
      // date `today` is in; only a calendar date must not pass it.
      issues.push({
        rule: 'date',
        severity: 'error',
        message: `In the future: ${date.slice(0, 10)}`,
        at,
      })
    }
  }
  p.sources.forEach((s, i) => {
    if (Number.isNaN(Date.parse(s.viewedAt))) return
    const age = days(s.viewedAt, today)
    if (age > MAX_SOURCE_AGE_DAYS) {
      issues.push({
        rule: 'date',
        severity: 'error',
        message: `Viewed ${age} days ago (${s.viewedAt}); the limit is ${MAX_SOURCE_AGE_DAYS}`,
        at: `sources[${i}]`,
      })
    }
  })
  return issues
}

/** Sections with something to show; money counts a joint committee. */
export function filledSections(p: CandidateProfile): number {
  return (
    Number(p.overview.items.length > 0) +
    Number(p.money.items.length > 0 || !!p.money.sharedCommittee) +
    Number(p.endorsements.items.length > 0)
  )
}

export const overviewWords = (p: CandidateProfile) =>
  p.overview.items.reduce((n, o) => n + countWords(o.text), 0)

/**
 * Equal coverage within a race: warns about a candidate with 2 or more
 * fewer filled sections than the fullest opponent, or under half the
 * overview words of the longest. A warning, not an error (user decision,
 * 2026-10-07): challengers often have far less public coverage, so it
 * doesn't hold the race back; review agents confirm each one is thin
 * because little is public, and the fix is more research, never trimming.
 * A race of one has nothing to compare.
 */
export function checkCoverage(race: CandidateProfile[]): Map<string, Issue[]> {
  const issues = new Map<string, Issue[]>(race.map((p) => [p.key, []]))
  if (race.length < 2) return issues
  const mostSections = Math.max(...race.map(filledSections))
  const mostWords = Math.max(...race.map(overviewWords))
  const fullest = race.find((p) => filledSections(p) === mostSections)
  const longest = race.find((p) => overviewWords(p) === mostWords)
  for (const p of race) {
    const list = issues.get(p.key) as Issue[]
    const sections = filledSections(p)
    if (mostSections - sections >= 2) {
      list.push({
        rule: 'coverage',
        severity: 'warning',
        message: `${sections} of 3 sections filled; ${fullest?.name} has ${mostSections}`,
      })
    }
    const words = overviewWords(p)
    if (words * 2 < mostWords) {
      list.push({
        rule: 'coverage',
        severity: 'warning',
        message: `Overview of ${words} words; ${longest?.name}'s has ${mostWords}`,
      })
    }
  }
  return issues
}

/** What opening one link gave. */
export interface LinkResult {
  url: string
  /** HTTP status after redirects, or 'error' for a network failure or timeout. */
  status: number | 'error'
  finalUrl?: string
  /** Set when the page looks like a login wall or paywall. */
  gate?: 'login' | 'paywall'
  checkedAt: string
}

const LOGIN_PATH =
  /\/(log-?in|sign-?in|signin|auth|account\/login|sso|session\/new)(\/|$|\?)/i
const PAYWALL_PATH = /\/(subscribe|subscription|paywall)(\/|$|\?)/i
const LOGIN_TEXT =
  /(please|you must) (log|sign) in to (continue|view|read)|sign in to your account to continue/i
const PAYWALL_TEXT =
  /"isAccessibleForFree"\s*:\s*"?false"?|subscribe (now )?to (continue|keep) reading|this (article|content) is (only )?(available|reserved) (to|for) (subscribers|members)|you('|’)ve reached your (free )?(article|story) limit/i

/** Looks at where a link ended up and the start of its page for a gate. */
export function detectGate(
  finalUrl: string,
  html: string,
): LinkResult['gate'] | undefined {
  let path = ''
  try {
    const u = new URL(finalUrl)
    path = `${u.pathname}${u.search}`
  } catch {
    return undefined
  }
  if (LOGIN_PATH.test(path) || LOGIN_TEXT.test(html)) return 'login'
  if (PAYWALL_PATH.test(path) || PAYWALL_TEXT.test(html)) return 'paywall'
  return undefined
}

/** Link problems for one profile, from the link results by URL. */
/** A status that means the page itself is gone, not that we were turned away. */
export const isDeadLink = (status: number | 'error') =>
  status === 404 || status === 410

export function checkLinks(
  p: CandidateProfile,
  results: Map<string, LinkResult>,
): Issue[] {
  const issues: Issue[] = []
  p.sources.forEach((s, i) => {
    const at = `sources[${i}]`
    const r = results.get(s.url)
    if (!r) {
      issues.push({
        rule: 'link',
        severity: 'error',
        message: 'Link not checked',
        at,
      })
      return
    }
    if (r.status === 'error' || r.status < 200 || r.status >= 300) {
      issues.push({
        rule: 'link',
        // Only a page that's gone (404, 410) is an error. Sites that turn
        // scripts away (403, 429), time out or fail on their side (5xx)
        // open fine for readers, so they're warnings for a reviewer
        // (user decision, 2026-10-07).
        severity: isDeadLink(r.status) ? 'error' : 'warning',
        message:
          r.status === 'error'
            ? `Didn't open: ${s.url}`
            : `HTTP ${r.status}: ${s.url}`,
        at,
      })
      return
    }
    if (r.finalUrl && isSocialMedia(r.finalUrl)) {
      issues.push({
        rule: 'source',
        severity: 'error',
        message: `Redirects to social media: ${r.finalUrl}`,
        at,
      })
    }
    if (r.gate) {
      issues.push({
        rule: 'link',
        // Paywalled news (mostly the Chicago Tribune) stays: readers often
        // get free articles. A login page is an error.
        severity: r.gate === 'login' ? 'error' : 'warning',
        message: `${r.gate === 'login' ? 'Login' : 'Paywall'} page: ${r.finalUrl ?? s.url}`,
        at,
      })
    }
  })
  return issues
}

/**
 * Plug point for the second-model check that each cited page supports the
 * sentence citing it. Not wired to a model yet: once one
 * is chosen, implement this and register it in scripts/profiles/check.ts.
 */
export interface SupportChecker {
  id: string
  /** Environment variable holding its API key. */
  keyName: string
  check(
    claim: string,
    source: { url: string; title: string },
  ): Promise<{
    supported: boolean | 'unclear'
    note?: string
    costUsd: number
  }>
}

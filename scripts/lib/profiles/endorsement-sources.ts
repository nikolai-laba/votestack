// Drops endorsements a model found on pages that can't show a November 3,
// 2026 general-election endorsement: old iVoterGuide elections,
// Ballotpedia and Wikipedia pages about a person (they mix primaries and past
// races), bare homepages, staging or proxy copies of a site, and newspaper
// editorials from the 2026 primary season. Deterministic and run on every
// assembly, so it applies to old research as well as new.
//
// An endorsement is dropped only when every source it cites breaks a rule;
// one good source keeps it. Bar evaluations come from the judges' file and
// are never filtered. Hand corrections (overrides) are applied after this
// filter, so they're never dropped by it.

import type {
  ProfileSource,
  CandidateProfile,
  Endorsement,
} from '../../../src/shared/profile.ts'
import { sameEndorser } from './endorsers.ts'

export type SourceRule =
  | 'ivoterguide-old-election'
  | 'ivoterguide-no-election'
  | 'reference-page'
  | 'homepage'
  | 'staging-or-proxy'
  | 'primary-editorial'

/** Why each rule exists, for logs and reviewers. */
export const SOURCE_RULES: Record<SourceRule, string> = {
  'ivoterguide-old-election':
    'iVoterGuide page for an election other than the November 3, 2026 general (its URL names the election)',
  'ivoterguide-no-election':
    "iVoterGuide candidate page that doesn't name an election, so it can't show which race an endorsement was for",
  'reference-page':
    "Ballotpedia or Wikipedia page that isn't about the 2026 election (a person's page mixes primaries and past races)",
  homepage:
    "An organization's bare homepage, which doesn't show the endorsement itself (a candidate's own campaign homepage is allowed: it often lists endorsements)",
  'staging-or-proxy':
    'A staging host or a proxy copy of another page, not the publisher’s own address',
  'primary-editorial':
    'A newspaper editorial from the 2026 primary season (dated before March 18, 2026, or about a primary)',
}

/** iVoterGuide's election id for the November 3, 2026 general. */
export const IVOTERGUIDE_GENERAL_2026 = 1443

/** The day after the March 17, 2026 primary: editorials before it were for the primary. */
export const GENERAL_SEASON_START = '2026-03-18'

const STAGING_HOSTS = [
  /\.mybluehost\.me$/,
  /\.wpengine\.com$/,
  /\.wpcomstaging\.com$/,
  /\.kinsta\.cloud$/,
  /\.pantheonsite\.io$/,
  /\.hostingersite\.com$/,
  /^(staging|stage|dev)\d*\./,
]

const hostIs = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`)

/** The date in a URL's path (`/2026/02/13/`, `/20260220/`, `/2026-02-13`), as YYYY-MM-DD. */
export function urlDate(path: string): string | undefined {
  const full =
    path.match(/\/(20\d\d)\/(\d\d)\/(\d\d)(?:\/|$)/) ??
    path.match(/\/(20\d\d)(\d\d)(\d\d)(?:\/|$)/) ??
    path.match(/\/(20\d\d)-(\d\d)-(\d\d)(?:[/-]|$)/)
  if (full) return `${full[1]}-${full[2]}-${full[3]}`
  // Year and month only: the month's last day, so a March date isn't
  // counted as before the primary.
  const month = path.match(/\/(20\d\d)\/(\d\d)(?:\/|$)/)
  if (month) {
    const last = new Date(Date.UTC(Number(month[1]), Number(month[2]), 0))
    return last.toISOString().slice(0, 10)
  }
  return undefined
}

/** The rule a source URL breaks for an endorsement of this kind, or null. */
export function sourceProblem(
  url: string,
  kind: Endorsement['kind'],
  /** The cited source's kind; a candidate's own campaign homepage often lists endorsements. */
  sourceKind?: ProfileSource['kind'],
): SourceRule | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  let path = u.pathname
  try {
    path = decodeURIComponent(u.pathname)
  } catch {
    // keep the raw path
  }
  const rest = `${path}${u.search}`

  if (
    STAGING_HOSTS.some((re) => re.test(host)) ||
    /\/https?(:|\/|%3a)/i.test(`${u.pathname}${u.search}`)
  )
    return 'staging-or-proxy'

  if ((path === '' || path === '/') && sourceKind !== 'candidate')
    return 'homepage'

  if (hostIs(host, 'ivoterguide.com')) {
    const election = rest.match(/\/election\/(\d+)/i)
    if (election)
      return Number(election[1]) === IVOTERGUIDE_GENERAL_2026
        ? null
        : 'ivoterguide-old-election'
    if (/^\/candidate\//i.test(path)) return 'ivoterguide-no-election'
    return null
  }

  if (hostIs(host, 'ballotpedia.org') || hostIs(host, 'wikipedia.org')) {
    const about2026 = /2026/.test(path) && /election/i.test(path)
    return about2026 ? null : 'reference-page'
  }

  if (kind === 'editorial_board') {
    const date = urlDate(path)
    if (date && date < GENERAL_SEASON_START) return 'primary-editorial'
    if (/(^|[^a-z])primar(y|ies)([^a-z]|$)/i.test(path))
      return 'primary-editorial'
  }
  return null
}

export interface RemovedEndorsement {
  key: string
  organization: string
  kind: Endorsement['kind']
  rule: SourceRule
  url: string
}

/**
 * Drops AI-found endorsements whose every cited source breaks a rule above.
 * `keep` names endorsers a hand correction replaces or adds (the override
 * brings its own sources), so the correction still finds them. Sources nothing
 * cites any more are left for compactSources to drop.
 */
export function filterEndorsementSources(
  p: CandidateProfile,
  keep: string[] = [],
): {
  profile: CandidateProfile
  removed: RemovedEndorsement[]
} {
  const removed: RemovedEndorsement[] = []
  const items = p.endorsements.items.filter((e) => {
    if (e.kind === 'bar_evaluation' || e.cites.length === 0) return true
    if (keep.some((k) => sameEndorser(k, e.organization))) return true
    const problems = e.cites.map((id) => {
      const source = p.sources.find((s) => s.id === id)
      return source
        ? {
            url: source.url,
            rule: sourceProblem(source.url, e.kind, source.kind),
          }
        : { url: '', rule: null }
    })
    if (problems.some((x) => x.rule === null)) return true
    const first = problems[0] as { url: string; rule: SourceRule }
    removed.push({
      key: p.key,
      organization: e.organization,
      kind: e.kind,
      rule: first.rule,
      url: first.url,
    })
    return false
  })
  if (removed.length === 0) return { profile: p, removed }
  return {
    profile: { ...p, endorsements: { ...p.endorsements, items } },
    removed,
  }
}

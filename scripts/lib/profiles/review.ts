// Puts every check together into one status per profile, the input
// for publishing and the review queue. Pure: links and support results are
// passed in.

import type { CandidateProfile } from '../../../src/shared/profile.ts'
import { runChecks, type Issue } from './checks.ts'
import { contentHash } from './content.ts'
import {
  checkCoverage,
  checkDates,
  checkLinks,
  type LinkResult,
} from './race-checks.ts'
import { groupByRace, raceKeysOf, type Subject } from './subjects.ts'

export interface ProfileCheck {
  status: 'passed' | 'flagged'
  /** Hash of the profile checked; publish ignores a result for other content. */
  contentHash: string
  raceKeys: string[]
  office: string
  name: string
  /** Errors: any one flags the profile. */
  reasons: string[]
  /** Reviewed by hand; don't block publishing. */
  warnings: string[]
}

export interface CheckFile {
  checkedAt: string
  today: string
  dir: string
  /** Whether cited links were opened (off for offline runs). */
  links: boolean
  profiles: Record<string, ProfileCheck>
  /** People on the ballot without a profile file. */
  missing: { key: string; name: string; raceKey: string }[]
}

export const formatIssue = (i: Issue) =>
  `${i.rule}${i.at ? ` ${i.at}` : ''}: ${i.message}`

export function reviewProfiles(
  profiles: Map<string, CandidateProfile>,
  subjects: Subject[],
  opts: {
    today: string
    links?: Map<string, LinkResult>
    extra?: Map<string, Issue[]>
  },
): Pick<CheckFile, 'profiles' | 'missing'> {
  const bySubject = new Map(subjects.map((s) => [s.key, s]))
  const issues = new Map<string, Issue[]>()
  for (const [key, p] of profiles) {
    issues.set(key, [
      ...runChecks(p).issues,
      ...checkDates(p, opts.today),
      ...(opts.links ? checkLinks(p, opts.links) : []),
      ...(opts.extra?.get(key) ?? []),
    ])
  }

  // Equal coverage among the profiles in each race.
  for (const [, race] of groupByRace(subjects)) {
    const inRace = race.flatMap((s) => {
      const p = profiles.get(s.key)
      return p ? [p] : []
    })
    for (const [key, found] of checkCoverage(inRace))
      issues.get(key)?.push(...found)
  }

  const out: CheckFile['profiles'] = {}
  for (const [key, p] of profiles) {
    const subject = bySubject.get(key)
    const list = issues.get(key) ?? []
    const reasons = list.filter((i) => i.severity === 'error').map(formatIssue)
    if (!subject) reasons.unshift('Not on the ballot any more')
    out[key] = {
      status: reasons.length === 0 ? 'passed' : 'flagged',
      contentHash: contentHash(p),
      raceKeys: subject ? raceKeysOf(subject) : [],
      office: p.office,
      name: p.name,
      reasons,
      warnings: list.filter((i) => i.severity === 'warning').map(formatIssue),
    }
  }
  const missing = subjects
    .filter((s) => !profiles.has(s.key))
    .map((s) => ({ key: s.key, name: s.name, raceKey: s.raceKey }))
  return { profiles: out, missing }
}

/** The reason check.ts gives when the checker could open none of a profile's cited pages. */
export const NONE_OPENED = 'source: the checker opened none of the cited pages'

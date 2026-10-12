// Pre-launch sample profiles: before every profile is written, each
// candidate's row links to a finished profile of someone similar, so people
// can give feedback on the design. The profile page says it's a sample and
// names both people. Every sample is cleared before launch.

import type { CandidateProfile } from '../../../src/shared/profile.ts'
import type { Subject } from './subjects.ts'

/** The finished profiles used as samples, by role. */
export const SAMPLE_KEYS = {
  democraticTop: 'juliana-stratton',
  democraticLegislature: 'jennifer-gong-gershowitz',
  democraticCounty: 'george-a-cardenas',
  democraticWater: 'precious-brady-davis',
  republicanTop: 'don-tracy',
  republicanMid: 'martin-mclaughlin',
  otherParty: 'whitfield-harrington-jr',
  nonpartisan: 'aaron-jitu-brown',
  smallOffice: 'connie-l-livingston',
  appellateRetention: 'bertina-e-lampkin',
  circuitRetention: 'kerry-m-kennedy',
  judicialCandidate: 'kim-przekota',
} as const

/** Stand-ins for samples that aren't written yet. */
const FALLBACK: Partial<Record<string, string>> = {
  [SAMPLE_KEYS.republicanTop]: SAMPLE_KEYS.democraticTop,
  [SAMPLE_KEYS.republicanMid]: SAMPLE_KEYS.democraticLegislature,
}

/**
 * Which sample stands in for this person: the same kind of race and tier,
 * and the same party where a sample exists (otherwise the closest one that
 * does). Someone with a finished profile is their own.
 */
export function sampleFor(subject: Subject, available: Set<string>): string {
  if (available.has(subject.key)) return subject.key
  const choice = pick(subject)
  return available.has(choice) ? choice : (FALLBACK[choice] ?? choice)
}

function pick(subject: Subject): string {
  const k = SAMPLE_KEYS
  if (subject.kind === 'retention')
    return /appellate/i.test(subject.office)
      ? k.appellateRetention
      : k.circuitRetention
  if (subject.kind === 'judicial_candidate') return k.judicialCandidate
  if (subject.tier === 'short') return k.smallOffice
  switch (subject.party) {
    case 'Democratic':
      if (subject.tier === 'top') return k.democraticTop
      if (subject.officeType === 'water_reclamation') return k.democraticWater
      if (
        subject.officeType === 'board_of_review' ||
        subject.officeType === 'county_board' ||
        subject.officeType === 'county_executive'
      )
        return k.democraticCounty
      return k.democraticLegislature
    case 'Republican':
      return subject.tier === 'top' ? k.republicanTop : k.republicanMid
    case undefined:
      return k.nonpartisan
    default:
      return k.otherParty
  }
}

/** The stand-in profile shown for `subject`, marked as a sample. */
export function sampleProfile(
  subject: Subject,
  profile: CandidateProfile,
): CandidateProfile {
  if (profile.key === subject.key) return profile
  return {
    ...profile,
    sample: { forName: subject.name, forOffice: subject.office },
  }
}

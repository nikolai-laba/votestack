// Who gets a profile: every person on the ballot, once, from the
// contest files. The Clerk's suburban list and the Board's Chicago list both
// carry countywide races, so a person usually appears in two contests that
// are the same race. Each person gets a race key that groups them with their
// opponents across both lists, a tier that sets the profile's length, and an
// office type for reports.

import type {
  CandidateContest,
  Contest,
  RetentionContest,
} from '../../../src/shared/ballot.ts'
import {
  profileKey,
  type ProfileKind,
  type ProfileTier,
} from '../../../src/shared/profile.ts'

/** A broad office category, for briefs and reports. */
export type OfficeType =
  | 'us_senate'
  | 'us_house'
  | 'statewide'
  | 'county_executive'
  | 'state_legislature'
  | 'county_board'
  | 'board_of_review'
  | 'water_reclamation'
  | 'school_board'
  | 'judicial_candidate'
  | 'retention'
  | 'regional_superintendent'
  | 'sanitary_district'
  | 'board_of_equalization'
  | 'city_executive'
  | 'city_council'
  | 'community_college'
  | 'special_district'
  | 'other'

export interface Subject {
  /** profileKey(name). */
  key: string
  name: string
  /** As printed on the ballot; omitted for nonpartisan races. */
  party?: string
  /** The office as voters would say it (readableOffice). */
  office: string
  /** One plain line on what a lesser-known office does, to steer research. */
  officeDescription?: string
  /** Every contest this person appears in, sorted. */
  contestIds: string[]
  districtId: string
  kind: ProfileKind
  tier: ProfileTier
  officeType: OfficeType
  /** Same for every candidate in a race; a judge up for retention stands alone. */
  raceKey: string
  /**
   * Other races the same person is in (confirmed by hand, see buildSubjects).
   * The profile publishes only when every one of their races passes.
   */
  alsoIn?: string[]
}

export interface Race {
  raceKey: string
  /** The office as voters see it. */
  office: string
  keys: string[]
}

export interface SubjectsFile {
  generatedAt: string
  electionId: string
  subjects: Subject[]
  races: Race[]
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const isJudge = (c: CandidateContest) =>
  /\bjudge\b/i.test(`${c.office} ${c.title}`)

/**
 * A contest's district without its ballot-order version: where candidate
 * order rotates by area (California), each order is its own contest in a
 * `…/ballot_rotation:N` district, but it's one race.
 */
export const baseDistrict = (districtId: string) =>
  districtId.replace(/\/ballot_rotation:\d+$/, '')

/** California offices, by the district IDs scripts/la/districts.ts gives them. */
function californiaOfficeType(id: string, office: string): OfficeType {
  if (/\/cd:\d+$/.test(id)) return 'us_house'
  if (/\/(sldl|sldu):\d+$/.test(id)) return 'state_legislature'
  if (/\/boe_district:\d+$/.test(id)) return 'board_of_equalization'
  if (/\/state:ca$/.test(id))
    return /united states senator/.test(office) ? 'us_senate' : 'statewide'
  if (/\/county:[a-z_]+\/council_district:\d+$/.test(id)) return 'county_board'
  if (/\/county:[a-z_]+$/.test(id)) return 'county_executive'
  if (/\/place:[a-z_]+\/council_district:\d+$/.test(id)) return 'city_council'
  if (/\/place:[a-z_]+$/.test(id))
    return /council/.test(office) ? 'city_council' : 'city_executive'
  if (/\/school_district:/.test(id)) return 'school_board'
  if (/\/community_college_district:/.test(id)) return 'community_college'
  if (/\/special_district:/.test(id)) return 'special_district'
  return 'other'
}

/** The office type of a contest, from its district and office. */
export function officeTypeFor(contest: Contest): OfficeType {
  if (contest.kind === 'retention') return 'retention'
  if (contest.kind === 'measure') return 'other'
  const id = baseDistrict(contest.districtId)
  const office = `${contest.office} ${contest.title}`.toLowerCase()
  if (isJudge(contest)) return 'judicial_candidate'
  if (/\/state:ca\b/.test(id)) return californiaOfficeType(id, office)
  if (/\/cd:\d+$/.test(id)) return 'us_house'
  if (/\/(sldl|sldu):\d+$/.test(id)) return 'state_legislature'
  if (
    /regional (office of education|superintendent)|superintendent/.test(office)
  )
    return 'regional_superintendent'
  if (/sanitary district/.test(office)) return 'sanitary_district'
  if (/\/sewer:mwrd$/.test(id) || /water reclamation/.test(office))
    return 'water_reclamation'
  if (/school_board_district|board of education/.test(`${id} ${office}`))
    return 'school_board'
  if (/board_of_review_district/.test(id) || /board of review/.test(office))
    return 'board_of_review'
  if (/council_district/.test(id)) return 'county_board'
  if (/\/state:il$/.test(id))
    return /senator/.test(office) ? 'us_senate' : 'statewide'
  if (
    /\/county:cook$/.test(id) &&
    /president|clerk|sheriff|treasurer|assessor/.test(office)
  )
    return 'county_executive'
  return 'other'
}

const TIERS: Record<OfficeType, ProfileTier> = {
  us_senate: 'top',
  us_house: 'top',
  statewide: 'top',
  county_executive: 'top',
  state_legislature: 'mid',
  county_board: 'mid',
  board_of_review: 'mid',
  water_reclamation: 'mid',
  school_board: 'mid',
  judicial_candidate: 'short',
  retention: 'short',
  regional_superintendent: 'short',
  sanitary_district: 'short',
  board_of_equalization: 'mid',
  city_executive: 'mid',
  city_council: 'mid',
  community_college: 'short',
  special_district: 'short',
  other: 'short',
}

export const tierFor = (type: OfficeType): ProfileTier => TIERS[type]

/** A contest's tier: by office type, except that California mayors get the top tier, like sheriffs. */
function tierOf(contest: Contest, type: OfficeType): ProfileTier {
  if (
    type === 'city_executive' &&
    contest.kind === 'candidate' &&
    /\/state:ca\b/.test(contest.districtId) &&
    /\bmayor\b/i.test(`${contest.office} ${contest.title}`)
  )
    return 'top'
  return tierFor(type)
}

export function kindFor(contest: Contest): ProfileKind {
  if (contest.kind === 'retention') return 'retention'
  if (contest.kind === 'candidate' && isJudge(contest))
    return 'judicial_candidate'
  return 'candidate'
}

/** The role within a district, so separate offices on one district differ. */
function role(contest: CandidateContest): string {
  const office = `${contest.office} ${contest.title}`.toLowerCase()
  const roles: [RegExp, string][] = [
    [/president of the chicago board of education/, 'school-board-president'],
    [/board of education/, 'school-board-member'],
    [/\bjudge\b/, 'judge'],
    // California elects its lieutenant governor in a race of its own.
    [/^lieutenant governor/, 'lieutenant-governor'],
    [/governor/, 'governor'],
    [/attorney general/, 'attorney-general'],
    [/secretary of state/, 'secretary-of-state'],
    [/comptroller/, 'comptroller'],
    [/senator/, 'senator'],
    [/representative/, 'representative'],
    [/treasurer/, 'treasurer'],
    [/president/, 'board-president'],
    [/clerk/, 'clerk'],
    [/sheriff/, 'sheriff'],
    [/assessor/, 'assessor'],
    [/superintendent/, 'superintendent'],
    [/board of review/, 'member'],
    [/insurance commissioner/, 'insurance-commissioner'],
    [/commissioner|trustee/, 'member'],
  ]
  return roles.find(([re]) => re.test(office))?.[1] ?? slug(contest.office)
}

/**
 * Identifies the race a contest is for, the same way in both lists: the
 * district, the role, the vacancy for judges and the term for split seats
 * (the Water Reclamation District elects full and unexpired terms apart).
 */
export function raceKeyFor(contest: Contest): string {
  if (contest.kind === 'retention')
    return `retention:${profileKey(contest.judge)}`
  if (contest.kind === 'measure') return `measure:${contest.id}`
  const parts = [
    baseDistrict(contest.districtId).replace(/^ocd-division\//, ''),
    role(contest),
  ]
  if (/unexpired/i.test(`${contest.id} ${contest.title} ${contest.office}`))
    parts.push('unexpired')
  else if (contest.vacancy) parts.push(slug(contest.vacancy))
  return parts.join('|')
}

const DESCRIPTIONS: Partial<Record<OfficeType, string>> = {
  board_of_review: 'hears property tax assessment appeals',
  water_reclamation: "runs the county's sewage treatment and flood control",
  school_board: 'helps run Chicago Public Schools',
  county_board: 'passes the Cook County budget and laws',
  sanitary_district: 'a small local sewer district in suburban Cook County',
  regional_superintendent: 'oversees schools in a regional office of education',
}

/** California's offices, where Cook County's descriptions don't fit. */
const CA_DESCRIPTIONS: Partial<Record<OfficeType, string>> = {
  board_of_equalization:
    "California's elected tax board: it oversees how counties assess property and handles some special taxes",
  school_board: 'helps run a local public school district',
  community_college: 'helps run a community college district',
  special_district:
    'a local special district board (for example water, health care, library or irrigation)',
}

/** The one-line description for an office type in the district's state. */
const descriptionFor = (type: OfficeType, districtId: string) =>
  /\/state:ca\b/.test(districtId) ? CA_DESCRIPTIONS[type] : DESCRIPTIONS[type]

/** "Retention: Judge, Circuit Court" → "Judge, Circuit Court". */
function officeTitle(contest: CandidateContest | RetentionContest): string {
  if (contest.kind === 'retention') return contest.office
  return contest.title.replace(/^Retention:\s*/, '')
}

/** 1 → "1st", 12 → "12th", 22 → "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`
}

/** The district's number from its OCD-ID ("…/cd:7" → "7th"), if it has one. */
function districtOrdinal(districtId: string): string | undefined {
  const n = /:(\d+)$/.exec(districtId)?.[1]
  return n ? ordinal(Number(n)) : undefined
}

const STATEWIDE: Record<string, string> = {
  governor: 'Governor and Lieutenant Governor',
  'attorney-general': 'Attorney General',
  'secretary-of-state': 'Secretary of State',
  comptroller: 'Comptroller',
  treasurer: 'Treasurer',
}

const COUNTYWIDE: Record<string, string> = {
  'board-president': 'Board President',
  clerk: 'Clerk',
  sheriff: 'Sheriff',
  treasurer: 'Treasurer',
  assessor: 'Assessor',
}

/**
 * The office as a voter would say it, for the profile header and the
 * research request: "U.S. Senator", "State Representative, 17th District",
 * "Board of Review Commissioner, 1st District", "Circuit Court Judge, Cook
 * County (Vacancy of Burke)". The official lists print offices inverted
 * ("Senator, U.S.", "Commissioner, Board of Review 1st District"), so the
 * title is rebuilt from the office type, the district and both lists'
 * titles (`contests`: one race as each list prints it, the Clerk's first).
 * The contest data itself keeps the official titles. Falls back to the
 * first list's title for an office no rule covers.
 */
export function readableOffice(
  contests: (CandidateContest | RetentionContest)[],
): string {
  const [first] = contests
  const titles = contests.map(officeTitle)
  const fallback = titles[0]
  const id = baseDistrict(first.districtId)
  if (/\/state:ca\b/.test(id)) return californiaOffice(first, fallback, id)
  const n = districtOrdinal(id)
  const matchTitle = (re: RegExp) =>
    titles.map((t) => re.exec(t)?.[1]).find(Boolean)

  if (first.kind === 'retention' || isJudge(first)) {
    const vacancy = first.kind === 'candidate' ? first.vacancy : undefined
    const seat = vacancy ? ` (${vacancy})` : ''
    if (/\/court_of_appeals:\d+$/.test(id) && n)
      return `Appellate Court Judge, ${n} District${seat}`
    if (/\/judicial_subcircuit:\d+$/.test(id) && n)
      return `Circuit Court Judge, ${n} Subcircuit${seat}`
    if (/\/county:cook$/.test(id))
      return `Circuit Court Judge, Cook County${seat}`
    return fallback
  }

  const type = officeTypeFor(first)
  const r = role(first)
  switch (type) {
    case 'us_senate':
      return 'U.S. Senator'
    case 'us_house':
      return n ? `U.S. Representative, ${n} District` : fallback
    case 'state_legislature': {
      const office = /\/sldu:/.test(id)
        ? 'State Senator'
        : 'State Representative'
      return n ? `${office}, ${n} District` : fallback
    }
    case 'statewide':
      return STATEWIDE[r] ? `Illinois ${STATEWIDE[r]}` : fallback
    case 'county_executive':
      return COUNTYWIDE[r] ? `Cook County ${COUNTYWIDE[r]}` : fallback
    case 'county_board':
      return n ? `Cook County Commissioner, ${n} District` : fallback
    case 'board_of_review':
      return n ? `Board of Review Commissioner, ${n} District` : fallback
    case 'water_reclamation': {
      const office = 'Metropolitan Water Reclamation District Commissioner'
      if (!raceKeyFor(first).endsWith('|unexpired')) return office
      // The Board's title gives the term's length; the Clerk's doesn't.
      const years = matchTitle(/Unexpired (\d+)-Year Term/i)
      return `${office} (unexpired ${years ? `${years}-year ` : ''}term)`
    }
    case 'school_board': {
      if (r === 'school-board-president')
        return 'Chicago Board of Education President'
      const sub = /school_board_district:(\w+)$/.exec(id)?.[1]
      return sub
        ? `Chicago Board of Education Member, Subdistrict ${sub.toUpperCase()}`
        : fallback
    }
    case 'regional_superintendent': {
      const county = matchTitle(
        /,\s*(\S.* County) Regional Office of Education/,
      )
      return county ? `Regional Superintendent of Schools, ${county}` : fallback
    }
    case 'sanitary_district': {
      const district = matchTitle(/,\s*(\S.* Sanitary District)/)
      return district ? `${district} Trustee` : fallback
    }
    default:
      return fallback
  }
}

/**
 * California offices as voters say them: "U.S. Representative, 28th
 * District", "State Senator, 22nd District", "Superior Court Judge, Los
 * Angeles County (Office No. 64)". Local offices keep the Registrar's title,
 * which already names the place ("City of Downey, Member of the City
 * Council, 2nd District").
 */
function californiaOffice(
  first: CandidateContest | RetentionContest,
  fallback: string,
  id: string,
): string {
  const n = districtOrdinal(id)
  if (first.kind === 'candidate' && isJudge(first)) {
    const seat = /Office No\.? ?(\d+)/i.exec(first.title)?.[1]
    return `Superior Court Judge, Los Angeles County${seat ? ` (Office No. ${seat})` : ''}`
  }
  if (first.kind === 'retention') return fallback
  switch (
    californiaOfficeType(id, `${first.office} ${first.title}`.toLowerCase())
  ) {
    case 'us_house':
      return n ? `U.S. Representative, ${n} District` : fallback
    case 'state_legislature':
      return n
        ? `${/\/sldu:/.test(id) ? 'State Senator' : 'State Assembly Member'}, ${n} District`
        : fallback
    case 'board_of_equalization':
      return n ? `Board of Equalization Member, ${n} District` : fallback
    case 'statewide':
      return `California ${fallback}`
    case 'county_executive':
      return `Los Angeles County ${fallback}`
    case 'county_board':
      return n ? `Los Angeles County Supervisor, ${n} District` : fallback
    default:
      return fallback
  }
}

const partyOf = (party: string | undefined) =>
  party && !/^(nonpartisan|non|none)$/i.test(party) ? party : undefined

interface Entry {
  contest: CandidateContest | RetentionContest
  name: string
  party?: string
}

/**
 * Everyone on the ballot, once per profileKey. Lists are read in order, so
 * the first list's titles and parties win (pass the Clerk's list first: its
 * titles name the office more fully). Throws when one key is in two races,
 * which means two people share a name, a race key is wrong, or one person
 * really runs twice; a person must look before any profile is made. Keys in
 * `samePerson` were confirmed as one person in several races: they keep one
 * profile, their contested race first (a retention vote goes to `alsoIn`).
 */
export function buildSubjects(
  lists: Contest[][],
  samePerson: ReadonlySet<string> = new Set(),
): {
  subjects: Subject[]
  races: Race[]
} {
  // Each race as every list prints it, the first list's first, for its title.
  const byRace = new Map<string, (CandidateContest | RetentionContest)[]>()
  for (const contest of lists.flat()) {
    if (contest.kind === 'measure') continue
    const raceKey = raceKeyFor(contest)
    byRace.set(raceKey, [...(byRace.get(raceKey) ?? []), contest])
  }
  const officeOf = (contest: CandidateContest | RetentionContest) =>
    readableOffice(byRace.get(raceKeyFor(contest)) ?? [contest])

  const byKey = new Map<string, Subject>()
  const errors: string[] = []
  for (const contests of lists) {
    for (const contest of contests) {
      const entries: Entry[] =
        contest.kind === 'candidate'
          ? contest.candidates.map((c) => ({
              contest,
              name: c.name,
              party: c.party,
            }))
          : contest.kind === 'retention'
            ? [{ contest, name: contest.judge }]
            : []
      for (const { contest, name, party } of entries) {
        const key = profileKey(name)
        const raceKey = raceKeyFor(contest)
        const existing = byKey.get(key)
        if (existing) {
          if (existing.raceKey !== raceKey && samePerson.has(key)) {
            const races = [existing.raceKey, ...(existing.alsoIn ?? [])]
            if (!races.includes(raceKey)) {
              const all = [...races, raceKey].sort(
                (a, b) =>
                  Number(a.startsWith('retention:')) -
                    Number(b.startsWith('retention:')) || a.localeCompare(b),
              )
              existing.raceKey = all[0]
              existing.alsoIn = all.slice(1)
              if (contest.kind === 'candidate' && raceKey === all[0]) {
                // The contested race names the office and the kind.
                const officeType = officeTypeFor(contest)
                existing.office = officeOf(contest)
                existing.officeType = officeType
                existing.tier = tierOf(contest, officeType)
                existing.kind = kindFor(contest)
                existing.districtId = baseDistrict(contest.districtId)
                existing.officeDescription = descriptionFor(
                  officeType,
                  contest.districtId,
                )
              }
            }
          } else if (existing.raceKey !== raceKey) {
            errors.push(
              `${key} is in two races: ${existing.raceKey} (${existing.contestIds.join(', ')}) and ${raceKey} (${contest.id})`,
            )
            continue
          }
          if (!existing.contestIds.includes(contest.id))
            existing.contestIds.push(contest.id)
          existing.party ??= partyOf(party)
          continue
        }
        const officeType = officeTypeFor(contest)
        byKey.set(key, {
          key,
          name,
          party: partyOf(party),
          office: officeOf(contest),
          officeDescription: descriptionFor(officeType, contest.districtId),
          contestIds: [contest.id],
          districtId: baseDistrict(contest.districtId),
          kind: kindFor(contest),
          tier: tierOf(contest, officeType),
          officeType,
          raceKey,
        })
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Subjects don't map cleanly to races:\n${errors.join('\n')}`,
    )
  }

  const subjects = [...byKey.values()]
    .map((s) => ({ ...s, contestIds: [...s.contestIds].sort() }))
    .sort(
      (a, b) =>
        a.raceKey.localeCompare(b.raceKey) || a.key.localeCompare(b.key),
    )
  const races = new Map<string, Race>()
  for (const s of subjects) {
    for (const raceKey of raceKeysOf(s)) {
      const race = races.get(raceKey) ?? {
        raceKey,
        office: s.office,
        keys: [],
      }
      race.keys.push(s.key)
      races.set(raceKey, race)
    }
  }
  return { subjects, races: [...races.values()] }
}

/** Every race a subject is in. */
export const raceKeysOf = (s: { raceKey: string; alsoIn?: string[] }) => [
  s.raceKey,
  ...(s.alsoIn ?? []),
]

/** Groups subjects by race; a person in several races is in each group. */
export function groupByRace<T extends { raceKey: string; alsoIn?: string[] }>(
  items: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    for (const raceKey of raceKeysOf(item)) {
      const group = groups.get(raceKey) ?? []
      group.push(item)
      groups.set(raceKey, group)
    }
  }
  return groups
}

// Groups a ballot's contests into sections by level of government, in ballot
// order within each section. Grouping uses the contest's district (OCD-ID) and
// kind rather than each source's numbering, which differs between authorities
// (the Cook County Clerk numbers referenda before the races), so
// sections read the same everywhere. The voter can switch to paper ballot
// order instead (`paperSections`). Within a section, a region can set the
// order of offices (`Region.officeOrder`) where its ballot order differs, and
// a measures section from more than one level is split into state, county,
// and city and local groups.

import type { Contest } from '../shared/ballot.ts'
import { COOK, type MeasureWords, type Region } from '../shared/regions.ts'

type LevelId =
  'federal' | 'state' | 'county' | 'judges' | 'local' | 'retention' | 'measures'

/**
 * Sections by level, plus 'races' for the races part of the paper order.
 * A paper part that comes back later on the ballot gets a numbered id
 * ('measures-2').
 */
export type SectionId = LevelId | 'races' | `${string}-${number}`

export interface Section {
  id: SectionId
  title: string
  /** Every contest in the section, in display order (groups included). */
  contests: Contest[]
  /**
   * Subgroups of a measures section that holds measures from more than one
   * level: state, then county, then city and local.
   */
  groups?: SectionGroup[]
}

export interface SectionGroup {
  /** 'state', 'county' or 'local'. */
  id: MeasureLevel
  title: string
  contests: Contest[]
}

type MeasureLevel = 'state' | 'county' | 'local'

/** Section titles that name the region's yes/no questions in its own words. */
const titleFor = (id: LevelId, words: MeasureWords) =>
  id === 'measures' ? words.section : LEVEL_TITLES[id]

export const LEVEL_TITLES: Record<LevelId, string> = {
  federal: 'Federal',
  state: 'State',
  county: 'County and regional',
  judges: 'Judges',
  local: 'City and local',
  retention: 'Judicial retention',
  measures: 'Referenda and questions',
}

const ORDER = Object.keys(LEVEL_TITLES) as LevelId[]

export function sectionFor(contest: Contest): LevelId {
  if (contest.kind === 'retention') return 'retention'
  if (contest.kind === 'measure') return 'measures'
  const office = `${contest.office} ${contest.title}`
  if (/\b(judge|justice)\b/i.test(office)) return 'judges'
  return districtLevel(contest.districtId, office)
}

/** The level of government of a district: federal, state, county or local. */
function districtLevel(
  district: string,
  office = '',
): 'federal' | 'state' | 'county' | 'local' {
  if (/\/cd:/.test(district) || /\b(U\.S\.|United States)/i.test(office))
    return 'federal'
  // Cities, townships and local districts. In California, school, college
  // and special districts sit under the county in their IDs but are local.
  if (
    /\/(place|township|tax_district|school_district|community_college_district|special_district):/.test(
      district,
    )
  )
    return 'local'
  // Counties, including Los Angeles County's supervisorial districts.
  if (/\/(county|sewer):/.test(district)) return 'county'
  return 'state'
}

const byBallotOrder = (a: Contest, b: Contest) =>
  (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0)

/**
 * The contest's rank in the region's office order, or Infinity when it
 * matches no office there.
 */
function officeRank(contest: Contest, order: RegExp[]): number {
  const names = [contest.title, 'office' in contest ? contest.office : '']
  const rank = order.findIndex((re) => names.some((name) => re.test(name)))
  return rank === -1 ? Infinity : rank
}

/** A measure's level for its group: federal questions go with the state's. */
const measureLevel = (contest: Contest): MeasureLevel => {
  const level = districtLevel(contest.districtId)
  return level === 'federal' ? 'state' : level
}

const MEASURE_LEVELS: MeasureLevel[] = ['state', 'county', 'local']

/** "State propositions", "County referenda", "City and local measures". */
function measureGroupTitle(level: MeasureLevel, words: MeasureWords): string {
  if (level === 'state') return words.state
  if (level === 'county') return `County ${words.many}`
  return `City and local ${words.many}`
}

/**
 * The part of a measure's title that names it, split into who puts it on
 * the ballot and its number or letter: "Proposition 1: Authorizes Bonds"
 * gives ['', '1']; "Los Angeles City General Municipal Election - Measure
 * TE" gives ['Los Angeles City General Municipal Election -', 'TE'].
 * Undefined for a title without one (Cook County's referenda have names).
 */
function measureDesignation(title: string): [string, string] | undefined {
  const match = /^(.*?)\b(?:Proposition|Measure) ([A-Z0-9]+)\b/.exec(title)
  return match ? [match[1].trim(), match[2]] : undefined
}

const compareText = (a: string, b: string) =>
  a.localeCompare(b, 'en', { numeric: true })

/**
 * Measures by number or letter (Proposition 2 before 10; each
 * jurisdiction's letters together) when every title carries one, and in
 * ballot order otherwise.
 */
function sortMeasures(contests: Contest[]): Contest[] {
  const named = contests.map((c) => measureDesignation(c.title))
  if (named.some((n) => n === undefined)) return contests
  const key = new Map(contests.map((c, i) => [c, named[i]!]))
  return [...contests].sort((a, b) => {
    const [whoA, idA] = key.get(a)!
    const [whoB, idB] = key.get(b)!
    return (
      compareText(whoA, whoB) || compareText(idA, idB) || byBallotOrder(a, b)
    )
  })
}

/**
 * State, county, and city and local groups of a measures section, or
 * undefined when its measures are all from one level.
 */
function measureGroups(
  contests: Contest[],
  words: MeasureWords,
): SectionGroup[] | undefined {
  const byLevel = new Map<MeasureLevel, Contest[]>()
  for (const contest of contests) {
    const level = measureLevel(contest)
    byLevel.set(level, [...(byLevel.get(level) ?? []), contest])
  }
  if (byLevel.size < 2) return undefined
  return MEASURE_LEVELS.filter((level) => byLevel.has(level)).map((level) => ({
    id: level,
    title: measureGroupTitle(level, words),
    contests: sortMeasures(byLevel.get(level)!),
  }))
}

/**
 * Non-empty sections in display order. Contests within a section follow
 * the region's office order where it has one, then ballot order; measures
 * from more than one level are grouped by level.
 */
export function groupContests(
  contests: Contest[],
  region: Region = COOK,
): Section[] {
  const words = region.measureWords
  const byId = new Map<LevelId, Contest[]>()
  for (const contest of contests) {
    const id = sectionFor(contest)
    byId.set(id, [...(byId.get(id) ?? []), contest])
  }
  const order = region.officeOrder
  const compare = order
    ? (a: Contest, b: Contest) =>
        officeRank(a, order) - officeRank(b, order) || byBallotOrder(a, b)
    : byBallotOrder
  return ORDER.filter((id) => byId.has(id)).map((id) => {
    const sorted = byId.get(id)!.sort(compare)
    const groups = id === 'measures' ? measureGroups(sorted, words) : undefined
    return {
      id,
      title: titleFor(id, words),
      contests: groups ? groups.flatMap((g) => g.contests) : sorted,
      ...(groups && { groups }),
    }
  })
}

/** True when every contest has its paper ballot position. */
export function hasPaperOrder(contests: Contest[]): boolean {
  return (
    contests.length > 0 &&
    contests.every((c) => typeof c.paperOrder === 'number')
  )
}

const PAPER_PARTS: Record<Contest['kind'], { id: LevelId | 'races' }> = {
  candidate: { id: 'races' },
  measure: { id: 'measures' },
  retention: { id: 'retention' },
}

/**
 * A title for one of several runs of the same kind on the paper ballot,
 * from its contests' level: "County measures", "State", or "Races" when
 * the races are from more than one level.
 */
function runTitle(contests: Contest[], words: MeasureWords): string {
  const kind = contests[0].kind
  if (kind === 'retention') return LEVEL_TITLES.retention
  if (kind === 'measure') {
    const levels = new Set(contests.map((c) => districtLevel(c.districtId)))
    const [level] = levels
    return levels.size === 1 && level !== 'federal'
      ? measureGroupTitle(level, words)
      : words.section
  }
  const levels = new Set(contests.map(sectionFor))
  return levels.size === 1 ? LEVEL_TITLES[[...levels][0]] : 'Races'
}

/**
 * The ballot in paper order: one section per part of the paper ballot
 * (races, referenda, judges up for retention) in the order the paper prints
 * them, and every contest in paper order. A part is a run of contests of
 * the same kind. Some ballots (Los Angeles County's) interleave the kinds:
 * local races, local measures, county races, county measures, and so on.
 * Then each run is its own section, titled by its level, and the later
 * runs of a kind get numbered ids ('measures-2'). Where each kind is one
 * run (Cook County), the parts keep their usual titles.
 */
export function paperSections(
  contests: Contest[],
  words: MeasureWords = COOK.measureWords,
): Section[] {
  const sorted = [...contests].sort(
    (a, b) => (a.paperOrder ?? Infinity) - (b.paperOrder ?? Infinity),
  )
  const runs: Contest[][] = []
  for (const contest of sorted) {
    const last = runs.at(-1)
    if (last && last[0].kind === contest.kind) last.push(contest)
    else runs.push([contest])
  }
  const runsOf = (kind: Contest['kind']) =>
    runs.filter((r) => r[0].kind === kind).length
  const seen = new Map<Contest['kind'], number>()
  return runs.map((run) => {
    const kind = run[0].kind
    const n = (seen.get(kind) ?? 0) + 1
    seen.set(kind, n)
    const base = PAPER_PARTS[kind].id
    const title =
      runsOf(kind) > 1
        ? runTitle(run, words)
        : base === 'races'
          ? 'Races'
          : titleFor(base, words)
    return {
      id: n === 1 ? base : (`${base}-${n}` as SectionId),
      title,
      contests: run,
    }
  })
}

/** Sections in the voter's chosen order; by level when paper order isn't known. */
export function sectionsFor(
  contests: Contest[],
  order: 'level' | 'paper',
  region: Region = COOK,
): Section[] {
  return order === 'paper' && hasPaperOrder(contests)
    ? paperSections(contests, region.measureWords)
    : groupContests(contests, region)
}

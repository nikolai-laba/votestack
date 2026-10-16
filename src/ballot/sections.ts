// Groups a ballot's contests into sections by level of government, in ballot
// order within each section. Grouping uses the contest's district (OCD-ID) and
// kind rather than each source's numbering, which differs between authorities
// (the Cook County Clerk numbers referenda before the races), so
// sections read the same everywhere. The voter can switch to paper ballot
// order instead (`paperSections`).

import type { Contest } from '../shared/ballot.ts'
import { COOK, type MeasureWords } from '../shared/regions.ts'

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
  contests: Contest[]
}

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

/** Non-empty sections in display order, contests in ballot order within each. */
export function groupContests(
  contests: Contest[],
  words: MeasureWords = COOK.measureWords,
): Section[] {
  const byId = new Map<LevelId, Contest[]>()
  for (const contest of contests) {
    const id = sectionFor(contest)
    byId.set(id, [...(byId.get(id) ?? []), contest])
  }
  return ORDER.filter((id) => byId.has(id)).map((id) => ({
    id,
    title: titleFor(id, words),
    contests: byId
      .get(id)!
      .sort((a, b) => (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0)),
  }))
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
    if (levels.size === 1) {
      const [level] = levels
      if (level === 'state') return words.state
      if (level === 'county') return `County ${words.many}`
      if (level === 'local') return `City and local ${words.many}`
    }
    return words.section
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
  words: MeasureWords = COOK.measureWords,
): Section[] {
  return order === 'paper' && hasPaperOrder(contests)
    ? paperSections(contests, words)
    : groupContests(contests, words)
}

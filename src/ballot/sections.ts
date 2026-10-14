// Groups a ballot's contests into sections by level of government, in ballot
// order within each section. Grouping uses the contest's district (OCD-ID) and
// kind rather than each source's numbering, which differs between authorities
// (the Cook County Clerk numbers referenda before the races), so
// sections read the same everywhere. The voter can switch to paper ballot
// order instead (`paperSections`).

import type { Contest } from '../shared/ballot.ts'

type LevelId =
  'federal' | 'state' | 'county' | 'judges' | 'local' | 'retention' | 'measures'

/** Sections by level, plus 'races' for the races part of the paper order. */
export type SectionId = LevelId | 'races'

export interface Section {
  id: SectionId
  title: string
  contests: Contest[]
}

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
  const district = contest.districtId
  if (/\/cd:/.test(district) || /\b(U\.S\.|United States)/i.test(office))
    return 'federal'
  if (/\/(place|township|tax_district):/.test(district)) return 'local'
  if (/\/(county|sewer):/.test(district)) return 'county'
  return 'state'
}

/** Non-empty sections in display order, contests in ballot order within each. */
export function groupContests(contests: Contest[]): Section[] {
  const byId = new Map<LevelId, Contest[]>()
  for (const contest of contests) {
    const id = sectionFor(contest)
    byId.set(id, [...(byId.get(id) ?? []), contest])
  }
  return ORDER.filter((id) => byId.has(id)).map((id) => ({
    id,
    title: LEVEL_TITLES[id],
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

const PAPER_PARTS: Record<Contest['kind'], { id: SectionId; title: string }> = {
  candidate: { id: 'races', title: 'Races' },
  measure: { id: 'measures', title: LEVEL_TITLES.measures },
  retention: { id: 'retention', title: LEVEL_TITLES.retention },
}

/**
 * The ballot in paper order: one section per part of the paper
 * ballot (races, referenda, judges up for retention) in the order the paper
 * prints the parts, and every contest in paper order within its part. The
 * parts don't interleave on the 2026 ballots; if they did, a contest would
 * join the first part of its kind.
 */
export function paperSections(contests: Contest[]): Section[] {
  const sorted = [...contests].sort(
    (a, b) => (a.paperOrder ?? Infinity) - (b.paperOrder ?? Infinity),
  )
  const parts = new Map<Contest['kind'], Contest[]>()
  for (const contest of sorted)
    parts.set(contest.kind, [...(parts.get(contest.kind) ?? []), contest])
  return [...parts].map(([kind, list]) => ({
    ...PAPER_PARTS[kind],
    contests: list,
  }))
}

/** Sections in the voter's chosen order; by level when paper order isn't known. */
export function sectionsFor(
  contests: Contest[],
  order: 'level' | 'paper',
): Section[] {
  return order === 'paper' && hasPaperOrder(contests)
    ? paperSections(contests)
    : groupContests(contests)
}

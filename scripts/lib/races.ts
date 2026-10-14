// Turns the official contest lists (one per election authority) into the
// public race list (src/shared/races.ts): each race once, with the contest
// id it has on each ballot. Used by scripts/export-contests.ts.

import type {
  CandidateContest,
  Contest,
  RetentionContest,
} from '../../src/shared/ballot.ts'
import { profileKey } from '../../src/shared/profile.ts'
import {
  RACE_LEVELS,
  buildRacePath,
  type BallotArea,
  type Race,
  type RaceLevel,
} from '../../src/shared/races.ts'
import { sectionFor } from '../../src/ballot/sections.ts'

type Listed = CandidateContest | RetentionContest

/**
 * One title style for every race. The Board's titles ("State Senator, 11th
 * District") are used as they are; the Clerk's are brought to the same
 * shape ("State Senator, 3rd Senate District" → "State Senator, 3rd District").
 */
export function raceTitle(contest: Listed): string {
  return contest.title
    .replace(/^Retention: /, '')
    .replace(/^Senator, U\.S\.$/, 'U.S. Senator')
    .replace(/, (?:State of Illinois|Cook County)$/, '')
    .replace(/^Board President$/, 'President, Cook County Board')
    .replace(
      /^Commissioner, (\d+\w\w) County Board District/,
      'County Commissioner, $1 District',
    )
    .replace(/ (?:Congressional|Senate|Representative) District\b/, ' District')
    .replace(/(\d+\w\w) Cook County Subcircuit/, '$1 Subcircuit')
}

/**
 * The district without a ballot-order version: where candidate order rotates
 * by area, each order is its own contest in a `…/ballot_rotation:N` district.
 */
const baseDistrict = (c: Contest) =>
  c.districtId.replace(/\/ballot_rotation:\d+$/, '')
const isRotation = (c: Contest) => c.districtId !== baseDistrict(c)

const names = (c: CandidateContest) =>
  c.candidates
    .map((p) => profileKey(p.name))
    .sort()
    .join('|')

/**
 * The same race on two ballots: same district and kind, and the same judge
 * or the same candidates (and seat). Statewide offices share a district, so
 * candidates tell them apart.
 */
function sameRace(a: Listed, b: Listed): boolean {
  if (a.kind !== b.kind || baseDistrict(a) !== baseDistrict(b)) return false
  if (a.kind === 'retention' && b.kind === 'retention')
    return profileKey(a.judge) === profileKey(b.judge)
  if (a.kind === 'candidate' && b.kind === 'candidate') {
    if (a.candidates.length === 0 || b.candidates.length === 0)
      return (
        a.candidates.length === b.candidates.length &&
        raceTitle(a) === raceTitle(b)
      )
    return names(a) === names(b)
  }
  return false
}

const area = (c: Contest): BallotArea =>
  /\/place:chicago$/.test(c.authorityId)
    ? 'chicago'
    : /\/county:los_angeles$/.test(c.authorityId)
      ? 'los-angeles-county'
      : 'suburban-cook'

/**
 * Every race once, by level of government and then in the Clerk's ballot
 * order (the Board's for races only on Chicago ballots, after the rest).
 */
export function buildRaces(
  contests: Contest[],
  date: string,
  /** Paths from the last export, by contest id, kept so addresses never change. */
  previous: Map<string, string> = new Map(),
): Race[] {
  const listed = contests.filter((c): c is Listed => c.kind !== 'measure')
  const groups: Listed[][] = []
  for (const contest of listed) {
    const group = groups.find(
      (g) =>
        sameRace(g[0], contest) &&
        // One contest per ballot, except a race's ballot-order versions.
        (isRotation(contest) || !g.some((c) => area(c) === area(contest))),
    )
    if (group) group.push(contest)
    else groups.push([contest])
  }

  const races = groups.map((group) => {
    // The Board's titles are already in the shared style.
    const titled = group.find((c) => area(c) === 'chicago') ?? group[0]
    // The Clerk's ballot order (Cook), or the only ballot's (elsewhere).
    const suburban = group.find((c) => area(c) !== 'chicago')
    const first = suburban ?? group[0]
    const title = raceTitle(titled)
    const judge = first.kind === 'retention' ? first.judge : undefined
    const level = sectionFor(first) as RaceLevel
    const race: Race = {
      level,
      path: buildRacePath(baseDistrict(first), date, title, judge),
      kind: first.kind,
      title,
      office: first.office,
      districtId: baseDistrict(first),
      contestIds: group.map((c) => c.id),
      ballots: (
        ['chicago', 'suburban-cook', 'los-angeles-county'] as const
      ).filter((a) => group.some((c) => area(c) === a)),
    }
    if (first.kind === 'candidate') {
      race.voteFor = first.voteFor
      if (first.vacancy) race.vacancy = first.vacancy
      race.candidates = [...first.candidates]
        .sort((a, b) => (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0))
        .map(({ name, party, designation, ballotOrder, incumbent }) => ({
          name,
          ...(party && { party }),
          ...(designation && { designation }),
          ...(ballotOrder !== undefined && { ballotOrder }),
          ...(incumbent && { incumbent }),
        }))
    } else race.judge = first.judge
    const order = suburban
      ? (suburban.ballotOrder ?? 0)
      : 1e9 + (group[0].ballotOrder ?? 0)
    return { race, level: RACE_LEVELS.indexOf(level), order }
  })

  races.sort((a, b) => a.level - b.level || a.order - b.order)
  // A race keeps the address it was first published at. Two seats with the
  // same title (one district electing two trustees separately) get
  // "-seat-2" and so on, in ballot order.
  const taken = new Set<string>()
  for (const { race } of races) {
    const kept = race.contestIds
      .map((id) => previous.get(id))
      .find((p) => p !== undefined)
    if (kept) race.path = kept
    taken.add(race.path)
  }
  const seen = new Set<string>()
  for (const { race } of races) {
    if (seen.has(race.path)) {
      let n = 2
      while (taken.has(`${race.path}-seat-${n}`)) n++
      race.path = `${race.path}-seat-${n}`
      taken.add(race.path)
    }
    seen.add(race.path)
  }
  return races.map((r) => r.race)
}

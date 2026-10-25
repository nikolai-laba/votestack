// The race lists (content/contests/, one per area, see src/shared/races.ts)
// and which candidates have a published profile (content/profiles/published/),
// for the race pages and for profiles opened without a ballot. All are
// committed files bundled into chunks of their own, loaded on demand, so
// they work offline in the apps and need no request to the Worker.

import { useQuery } from '@tanstack/react-query'
import type { CandidateContest, RetentionContest } from '../shared/ballot.ts'
import { profileKey } from '../shared/profile.ts'
import { REGIONS, regionForElection } from '../shared/regions.ts'
import type { Race, RaceList } from '../shared/races.ts'

export interface RaceData {
  /** One list per area, in the order of the regions VoteStack covers. */
  lists: RaceList[]
  /**
   * Keys (profileKey(name)) of the candidates with a published profile, by
   * election ID. A key counts only in its own election, so a namesake in
   * another area never links to someone else's profile.
   */
  published: Record<string, string[]>
}

export const RACES_QUERY_KEY = ['races'] as const

// Every area's list and every published list; a missing one is skipped.
const RACE_LISTS = import.meta.glob<{ default: RaceList }>(
  '../../content/contests/**/*.json',
)
const PUBLISHED_LISTS = import.meta.glob<{
  default: { electionId: string; profiles: Record<string, string> }
}>('../../content/profiles/published/**/*.json')

const regionIndex = (list: RaceList) => {
  const region = regionForElection(list.electionId)
  return region ? REGIONS.indexOf(region) : REGIONS.length
}

export async function loadRaces(): Promise<RaceData> {
  const [lists, published] = await Promise.all([
    Promise.all(Object.values(RACE_LISTS).map((load) => load())),
    Promise.all(Object.values(PUBLISHED_LISTS).map((load) => load())),
  ])
  const keys: Record<string, string[]> = {}
  for (const { default: file } of published)
    keys[file.electionId] = [
      ...(keys[file.electionId] ?? []),
      ...Object.keys(file.profiles),
    ]
  return {
    lists: lists
      .map((m) => m.default)
      .sort(
        (a, b) =>
          regionIndex(a) - regionIndex(b) ||
          a.areaPath.localeCompare(b.areaPath),
      ),
    published: keys,
  }
}

/** The published profiles that a list's candidates can link to. */
export const publishedFor = (data: RaceData, list: RaceList) =>
  new Set(data.published[list.electionId] ?? [])

/** The race at a path after /races/, with the list it's in. */
export function findRace(
  data: RaceData,
  path: string,
): { race: Race; list: RaceList } | undefined {
  for (const list of data.lists) {
    const race = list.races.find((r) => r.path === path)
    if (race) return { race, list }
  }
  return undefined
}

export function useRaces() {
  return useQuery({
    queryKey: RACES_QUERY_KEY,
    queryFn: loadRaces,
    staleTime: Infinity,
  })
}

/** The races a profile's person is in, by the contest ids on the profile, with their lists. */
export function racesFor(
  data: Pick<RaceData, 'lists'>,
  electionId: string,
  contestIds: string[],
): { race: Race; list: RaceList }[] {
  return data.lists
    .filter((list) => list.electionId === electionId)
    .flatMap((list) =>
      list.races
        .filter((r) => r.contestIds.some((id) => contestIds.includes(id)))
        .map((race) => ({ race, list })),
    )
}

/**
 * Every candidate's profile key in each race a profile's person is in, from
 * the race list, the person's own first: a retention judge is a race of one. Undefined when the list
 * has none of the person's races, so a gap in the list never counts as a
 * race with one candidate.
 */
export function raceKeysFor(
  data: Pick<RaceData, 'lists'>,
  profile: { key: string; electionId: string; contestIds: string[] },
): string[][] | undefined {
  const races = racesFor(data, profile.electionId, profile.contestIds)
  if (races.length === 0) return undefined
  return races.map(({ race }) =>
    race.kind === 'retention'
      ? [profile.key]
      : [
          profile.key,
          ...(race.candidates ?? [])
            .map((c) => profileKey(c.name))
            .filter((k) => k !== profile.key),
        ],
  )
}

/** A race in the ballot's shape, so it can use the ballot's race card. */
export function raceContest(
  race: Race,
  electionId: string,
): CandidateContest | RetentionContest {
  const base = {
    id: race.contestIds[0],
    electionId,
    districtId: race.districtId,
    authorityId: '',
    title: race.title,
    sources: [],
    lastVerified: '',
  }
  return race.kind === 'retention'
    ? {
        ...base,
        kind: 'retention',
        office: race.office,
        judge: race.judge ?? '',
      }
    : {
        ...base,
        kind: 'candidate',
        office: race.office,
        voteFor: race.voteFor ?? 1,
        ...(race.vacancy && { vacancy: race.vacancy }),
        candidates: race.candidates ?? [],
      }
}

/** Router state from a race's address form: open the ballot at that race. */
export interface RaceHandoffState {
  focusRace: {
    contestIds: string[]
    title: string
  }
}

export function isRaceHandoffState(value: unknown): value is RaceHandoffState {
  const race = (value as Partial<RaceHandoffState> | null)?.focusRace
  return Array.isArray(race?.contestIds) && typeof race.title === 'string'
}

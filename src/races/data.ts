// The race list (content/contests/, see src/shared/races.ts) and which
// candidates have a published profile (content/profiles/published/), for
// the race pages and for profiles opened without a ballot. Both are
// committed files bundled into a chunk of their own, loaded on demand, so
// they work offline in the apps and need no request to the Worker.

import { useQuery } from '@tanstack/react-query'
import type { CandidateContest, RetentionContest } from '../shared/ballot.ts'
import { CURRENT_ELECTION } from '../shared/cook.ts'
import type { Race, RaceList } from '../shared/races.ts'

export interface RaceData {
  list: RaceList
  /** Keys (profileKey(name)) of the candidates with a published profile. */
  published: string[]
}

export const RACES_QUERY_KEY = ['races', CURRENT_ELECTION.date] as const

export async function loadRaces(): Promise<RaceData> {
  // Import paths must be literal: the current election's date (CURRENT_ELECTION).
  const [list, published] = await Promise.all([
    import('../../content/contests/2026-11-03.json'),
    import('../../content/profiles/published/2026-11-03.json'),
  ])
  return {
    list: list.default as RaceList,
    published: Object.keys(published.default.profiles),
  }
}

export function useRaces() {
  return useQuery({
    queryKey: RACES_QUERY_KEY,
    queryFn: loadRaces,
    staleTime: Infinity,
  })
}

/** The races a profile's person is in, by the contest ids on the profile. */
export function racesFor(list: RaceList, contestIds: string[]): Race[] {
  return list.races.filter((r) =>
    r.contestIds.some((id) => contestIds.includes(id)),
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

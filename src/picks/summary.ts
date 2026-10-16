// Reading picks against a ballot: what's picked in each race, the counts for
// Saved choices, and the picks for races that aren't on the saved ballot.

import type { CandidateContest, Contest } from '../shared/ballot.ts'
import { profileKey } from '../shared/profile.ts'
import { COOK, type MeasureWords } from '../shared/regions.ts'
import type { Choice, Picks, SavedBallot } from './store.ts'

export function choicesFor(picks: Picks, contest: Contest): Choice[] {
  return picks[contest.electionId]?.[contest.id] ?? []
}

/** The names picked in a candidate race, in official ballot order. */
export function pickedCandidates(picks: Picks, contest: Contest) {
  if (contest.kind !== 'candidate') return []
  const chosen = new Set(choicesFor(picks, contest))
  return [...contest.candidates]
    .sort((a, b) => (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0))
    .filter((c) => chosen.has(profileKey(c.name)))
}

interface Tally {
  picked: number
  total: number
}

export interface PickCounts {
  races: Tally
  retention: Tally
  measures: Tally
  /** Items with at least one pick: races, judges and referenda each count once. */
  picked: number
}

export function pickCounts(ballot: SavedBallot, picks: Picks): PickCounts {
  const counts: PickCounts = {
    races: { picked: 0, total: 0 },
    retention: { picked: 0, total: 0 },
    measures: { picked: 0, total: 0 },
    picked: 0,
  }
  for (const contest of ballot.contests) {
    const tally =
      contest.kind === 'candidate'
        ? counts.races
        : contest.kind === 'retention'
          ? counts.retention
          : counts.measures
    tally.total++
    if (choicesFor(picks, contest).length) {
      tally.picked++
      counts.picked++
    }
  }
  return counts
}

/** "3 of 26 races, 10 of 60 judges up for retention and 0 of 2 referenda" */
export function pickCountText(
  counts: PickCounts,
  words: MeasureWords = COOK.measureWords,
): string {
  const part = ({ picked, total }: Tally, one: string, many: string) =>
    total ? `${picked} of ${total} ${total === 1 ? one : many}` : ''
  const parts = [
    part(counts.races, 'race', 'races'),
    part(counts.retention, 'judge', 'judges') &&
      `${part(counts.retention, 'judge', 'judges')} up for retention`,
    part(counts.measures, words.one, words.many),
  ].filter(Boolean)
  if (parts.length === 0) return 'no races'
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : parts[0]
}

/**
 * Said to screen readers when a pick in a full race takes another's place:
 * "Picked Jane Doe instead of John Roe."
 */
export function swapText(
  contest: CandidateContest,
  picked: Choice,
  replaced: Choice,
): string {
  const name = (key: Choice) =>
    contest.candidates.find((c) => profileKey(c.name) === key)?.name ?? key
  return `Picked ${name(picked)} instead of ${name(replaced)}.`
}

/**
 * Picks kept on the device for races that aren't on the saved ballot (from
 * another address or an earlier ballot). They're hidden until removed.
 */
export function hiddenPickCount(
  ballot: SavedBallot | null,
  picks: Picks,
): number {
  const onBallot = new Set(
    ballot?.contests.map((c) => `${c.electionId}\u0000${c.id}`),
  )
  let hidden = 0
  for (const [election, contests] of Object.entries(picks))
    for (const id of Object.keys(contests))
      if (!onBallot.has(`${election}\u0000${id}`)) hidden++
  return hidden
}

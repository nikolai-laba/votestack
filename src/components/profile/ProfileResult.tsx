import { Link } from 'react-router'
import { longDateTime } from '../../format.ts'
import { useRaces, racesFor } from '../../races/data.ts'
import {
  useGroupResults,
  useElectionCheckedAt,
  useElectionHasResults,
  useElectionResultsPending,
} from '../../results/context.tsx'
import {
  personOutcome,
  shareText,
  type RaceResult,
} from '../../shared/raceResults.ts'
import { racePath, type Race } from '../../shared/races.ts'
import type { CandidateProfile } from '../../shared/profile.ts'
import { CheckIcon } from '../icons.tsx'
import { ResultCaption } from '../results/ResultCaption.tsx'
import { officialResultsUrl, resultRegion } from '../results/useRaceResults.ts'

const WRITTEN_FOR =
  "This profile was written for the Tuesday, November 3, 2026 election. It isn't updated after the election, except for the result."

export interface ProfileResults {
  /** The election has results that haven't loaded (or the races they belong to haven't). */
  pending: boolean
  /** The person's races that have a result, in race list order. */
  entries: { race: Race; result: RaceResult }[]
  /** Whether the header and article follow a result: it shows, or its space is held. */
  shown: boolean
}

/**
 * What a profile shows for its election's results. The switch is the
 * election's own results file, never the site-wide after-election switch. A
 * race the results leave out has no entry, so a profile with none of its
 * races in the results is as it was on Election Day.
 */
export function useProfileResults(profile: CandidateProfile): ProfileResults {
  const has = useElectionHasResults(profile.electionId)
  const resultsPending = useElectionResultsPending(profile.electionId)
  const races = useRaces()
  const found = racesFor(
    races.data ?? { lists: [] },
    profile.electionId,
    profile.contestIds,
  )
  const results = useGroupResults(
    profile.electionId,
    found.map(({ race }) => race.contestIds),
  )
  if (!has) return { pending: false, entries: [], shown: false }
  const pending = resultsPending || (!races.data && !races.isError)
  const entries = found.flatMap(({ race }, i) =>
    results[i] ? [{ race, result: results[i] }] : [],
  )
  return { pending, entries, shown: pending || entries.length > 0 }
}

/** "66.0%", or "under 0.1%" in a sentence. */
const inSentence = (text: string) =>
  text.replace(/^(Under|Over)/, (w) => w.toLowerCase())

/** "Alex Rivera", "Alex Rivera and Sam Moore" */
const andList = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
    : (items[0] ?? '')

const needed = (threshold: number) =>
  threshold === 0.5 ? 'majority' : `${Math.round(threshold * 1000) / 10}%`

/** The block's first line, by the person's outcome. */
function headline(result: RaceResult, name: string): string {
  const { outcome, share } = personOutcome(result, name)
  const pct =
    share === undefined ? '' : inSentence(shareText(share, result.threshold))
  switch (outcome) {
    case 'won':
      return `Won, with ${pct} of the vote`
    case 'elected':
      return `Elected, with ${pct} of the vote`
    case 'not_elected':
      return `Not elected, with ${pct} of the vote`
    case 'leading':
      return `Leading, with ${pct} of the unofficial count`
    case 'trailing':
      return `${pct} of the unofficial count so far`
    case 'retained':
      return `Retained, with ${pct} yes`
    case 'not_retained':
      return `Not retained, with ${pct} yes${
        result.threshold === undefined
          ? ''
          : ` (${needed(result.threshold)} needed)`
      }`
    case 'uncalled':
      return result.status === 'too_close'
        ? 'Too close to call'
        : 'Not called yet'
  }
}

/** The caption's first part: the race's own line, or who won for everyone else. */
function Caption({
  result,
  electionId,
  contestId,
  name,
}: {
  result: RaceResult
  electionId: string
  contestId: string
  name: string
}) {
  const checkedAt = useElectionCheckedAt(electionId)
  const region = resultRegion(electionId)
  const { outcome, winners } = personOutcome(result, name)
  const decided = result.status === 'called' || result.status === 'certified'
  if (decided && outcome === 'not_elected') {
    const day = (iso: string) =>
      longDateTime(iso, region.timeZone, region.zoneLabel).replace(
        /, \d{1,2}(:\d{2})? [ap]\.m\. \w+$/,
        '',
      )
    const basis =
      result.status === 'certified' && result.certified
        ? `certified ${day(`${result.certified.on}T12:00:00Z`)}`
        : result.call
          ? `AP call, ${day(result.call.at)}`
          : undefined
    return (
      <p className="text-caption text-muted italic">
        {andList(winners)} won{basis ? ` (${basis})` : ''}.
      </p>
    )
  }
  return (
    <ResultCaption
      result={result}
      region={region}
      checkedAt={checkedAt}
      officialUrl={officialResultsUrl(contestId, result)}
      className="text-caption text-muted italic"
    />
  )
}

/** One race's block: the outcome, then a caption, a link to the race and a note on the profile. */
function RaceBlock({
  profile,
  race,
  result,
}: {
  profile: CandidateProfile
  race: Race
  result: RaceResult
}) {
  const { outcome } = personOutcome(result, profile.name)
  const win =
    outcome === 'won' || outcome === 'elected' || outcome === 'retained'
  return (
    <div
      data-result-block=""
      data-fill={win ? 'win' : undefined}
      className={`space-y-1 rounded-sm border border-line p-4 ${win ? '' : 'bg-surface'}`}
    >
      <p className="flex items-center gap-2 text-body font-bold">
        {win && <CheckIcon />}
        {headline(result, profile.name)}
      </p>
      <Caption
        result={result}
        electionId={profile.electionId}
        contestId={race.contestIds[0]}
        name={profile.name}
      />
      <p>
        <Link
          to={racePath(race)}
          className="inline-flex min-h-11 items-center font-semibold"
        >
          See the race
        </Link>
      </p>
      <p className="text-caption text-muted italic">{WRITTEN_FOR}</p>
    </div>
  )
}

/** A block's space while the results load: no text, same room as a called race's block. */
function Placeholder() {
  return (
    <div
      aria-hidden="true"
      data-result-block=""
      data-results-placeholder=""
      className="min-h-40 space-y-2 rounded-sm border border-line bg-surface p-4"
    >
      <div className="h-5 w-2/3 rounded-sm bg-band" />
      <div className="h-4 w-full rounded-sm bg-band" />
      <div className="h-4 w-1/2 rounded-sm bg-band" />
    </div>
  )
}

/**
 * How the person's race turned out, in the profile header, for an election
 * with results: one block per race the person is in. The rest of the profile
 * stays as it was on Election Day.
 */
export function ProfileResult({ profile }: { profile: CandidateProfile }) {
  const { pending, entries } = useProfileResults(profile)
  if (entries.length === 0) return pending ? <Placeholder /> : null
  return entries.map(({ race, result }) => (
    <RaceBlock key={race.path} profile={profile} race={race} result={result} />
  ))
}

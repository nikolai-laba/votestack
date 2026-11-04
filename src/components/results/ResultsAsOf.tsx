import { longDateTime } from '../../format.ts'
import {
  useElectionCheckedAt,
  useElectionHasResults,
  useElectionResultsPending,
} from '../../results/context.tsx'
import type { Region } from '../../shared/regions.ts'
import type { ResultsOffice } from '../../shared/results.ts'
import { VotingEndedLine } from '../VotingEndedLine.tsx'

const CLASS = 'max-w-[65ch] text-caption text-muted italic'

/**
 * "Results as of Thursday, November 5, 2026, 7:30 p.m. CT. Counts are
 * unofficial until certified." Its space is kept while the results load.
 */
export function ResultsAsOf({
  electionId,
  region,
}: {
  electionId: string
  region: Region
}) {
  const checkedAt = useElectionCheckedAt(electionId)
  if (!checkedAt)
    return (
      <div aria-hidden="true" data-results-placeholder="" className={CLASS}>
        {['w-full', 'w-1/2'].map((width, i) => (
          <span key={i} className="flex h-4.5 items-center">
            <span className={`h-3 rounded-sm bg-band ${width}`} />
          </span>
        ))}
      </div>
    )
  return (
    <p className={CLASS}>
      {`Results as of ${longDateTime(checkedAt, region.timeZone, region.zoneLabel)}. Counts are unofficial until certified.`}
    </p>
  )
}

/**
 * The line under an election's title once voting has ended: "Results as
 * of…" for an election with results, "Voting ended…" with the offices'
 * links otherwise (and if the results couldn't be loaded).
 */
export function ElectionEndedLine({
  electionId,
  region,
  offices,
}: {
  electionId: string
  region: Region
  offices: ResultsOffice[]
}) {
  const has = useElectionHasResults(electionId)
  const pending = useElectionResultsPending(electionId)
  const checkedAt = useElectionCheckedAt(electionId)
  if (has && (pending || checkedAt))
    return <ResultsAsOf electionId={electionId} region={region} />
  return <VotingEndedLine offices={offices} />
}

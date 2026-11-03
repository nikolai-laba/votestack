import { Fragment } from 'react'
import { longDate } from '../format.ts'
import { AFTER_ELECTION } from '../shared/afterElection.ts'
import { CURRENT_ELECTION } from '../shared/cook.ts'
import type { ResultsOffice } from '../shared/results.ts'

/**
 * Once voting has ended, says so and links the election offices that count
 * the votes. The line is part of the page's prerendered HTML. It names each
 * office's place only when there is more than one, to tell them apart. Shows
 * nothing before the election is over, or when no office is known.
 */
export function VotingEndedLine({ offices }: { offices: ResultsOffice[] }) {
  if (!AFTER_ELECTION || offices.length === 0) return null
  const named = offices.length > 1
  return (
    <p className="max-w-[65ch]">
      {`Voting ended on ${longDate(CURRENT_ELECTION.date)}. See official results from the `}
      {offices.map((office, i) => (
        <Fragment key={office.url}>
          {i > 0 && (i === offices.length - 1 ? ' and the ' : ', the ')}
          <a href={office.url} target="_blank" rel="noreferrer">
            {office.name}
          </a>
          {named && ` (${office.place})`}
        </Fragment>
      ))}
      .
    </p>
  )
}

import { useState } from 'react'
import { Link } from 'react-router'
import {
  GET_STARTED_PATH,
  raceAnchorId,
  type RaceLinkState,
} from '../ballot/profileLinks.ts'
import type { FocusAddressState } from '../ballot/session.ts'
import { longDate } from '../format.ts'
import { raceContest, racesFor, useRaces } from '../races/data.ts'
import type { Ballot } from '../shared/ballot.ts'
import type { CandidateProfile } from '../shared/profile.ts'
import {
  ballotsText,
  raceName,
  racePath,
  whoVotes,
  type Race,
  type RaceList,
} from '../shared/races.ts'
import { AddressForm } from './AddressForm.tsx'
import { RaceCard } from './BallotView.tsx'

// The parts of a race page that a profile opened without a ballot shares:
// the facts about the race, its card, and the way to the voter's own ballot.

/** Election day, who votes and which ballots list it, as labeled fields. */
export function RaceFacts({ race, list }: { race: Race; list: RaceList }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
      <dt className="text-muted">Election day</dt>
      <dd>{longDate(list.date)}</dd>
      <dt className="text-muted">Who votes</dt>
      <dd>{whoVotes(race.districtId)}</dd>
      <dt className="text-muted">On ballots in</dt>
      <dd>{ballotsText(race.ballots)}</dd>
    </dl>
  )
}

/** The race's card, in official ballot order, with no pick boxes. */
export function RaceCardFor({
  race,
  list,
  published,
}: {
  race: Race
  list: RaceList
  published: Set<string>
}) {
  return (
    <div className="space-y-2">
      {race.kind === 'candidate' && (
        <p className="text-small text-muted">
          Candidates are listed in official ballot order.
        </p>
      )}
      <RaceCard
        contest={raceContest(race, list.electionId)}
        published={published}
      />
    </div>
  )
}

/**
 * The way from a race to the voter's own ballot. With a ballot already
 * looked up, says whether this race is on it; otherwise the address form,
 * which opens the ballot at this race.
 */
export function YourBallot({
  race,
  ballot,
  headingId,
}: {
  race: Race
  ballot?: Ballot
  headingId: string
}) {
  // Chosen when the page opens: a lookup from the form below opens the
  // ballot itself, so the form stays until then.
  const [lookedUp] = useState(ballot !== undefined)
  const onBallot = ballot?.contests.find((c) => race.contestIds.includes(c.id))
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-md border border-line bg-surface p-4"
    >
      <h2 id={headingId} className="text-section">
        Is this race on your ballot?
      </h2>
      {lookedUp && ballot ? (
        onBallot ? (
          <>
            <p>Yes, it&apos;s on the ballot you looked up.</p>
            <Link
              to="/"
              state={
                { focusId: raceAnchorId(onBallot.id) } satisfies RaceLinkState
              }
              className="inline-flex min-h-11 items-center"
            >
              Show it on your ballot
            </Link>
          </>
        ) : (
          <>
            <p>It isn&apos;t on the ballot you looked up.</p>
            <Link
              to={GET_STARTED_PATH}
              state={{ focusAddress: true } satisfies FocusAddressState}
              className="inline-flex min-h-11 items-center"
            >
              Search a new address
            </Link>
          </>
        )
      ) : (
        <>
          <p className="max-w-[65ch]">
            Enter your address to see every race on your ballot. If this race is
            on it, your ballot opens there.
          </p>
          <AddressForm
            race={{ contestIds: race.contestIds, title: raceName(race) }}
          />
        </>
      )}
    </section>
  )
}

/**
 * Under a profile opened without this person on the voter's ballot (most
 * often from a search): the race(s) they're in, with everyone in it, and
 * the way to the voter's own ballot.
 */
export function ProfileRaces({
  profile,
  ballot,
}: {
  profile: CandidateProfile
  ballot?: Ballot
}) {
  const query = useRaces()
  if (!query.data) return null
  const { list } = query.data
  const races = racesFor(list, profile.contestIds)
  if (races.length === 0) return null
  const published = new Set(query.data.published)
  return (
    <div className="space-y-6 border-t border-line pt-6">
      {races.map((race) => (
        <section
          key={race.path}
          aria-labelledby={`race-${race.path}`}
          className="space-y-3"
        >
          <h2 id={`race-${race.path}`} className="text-section">
            On the ballot: <Link to={racePath(race)}>{raceName(race)}</Link>
          </h2>
          <RaceFacts race={race} list={list} />
          <RaceCardFor race={race} list={list} published={published} />
        </section>
      ))}
      <YourBallot race={races[0]} ballot={ballot} headingId="your-ballot" />
    </div>
  )
}

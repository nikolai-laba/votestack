import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  GET_STARTED_PATH,
  raceAnchorId,
  type RaceLinkState,
} from '../ballot/profileLinks.ts'
import { useBallotOrder } from '../ballot/orderPreference.ts'
import { sectionsFor } from '../ballot/sections.ts'
import { BallotOrderToggle } from '../components/BallotOrderToggle.tsx'
import { PickNotices } from '../components/picks/PickControls.tsx'
import { longDate } from '../format.ts'
import { ballotStore, useBallotStore, type Picks } from '../picks/store.ts'
import {
  choicesFor,
  pickCountText,
  pickCounts,
  pickedCandidates,
} from '../picks/summary.ts'
import type { Contest } from '../shared/ballot.ts'
import { COOK, regionForElection } from '../shared/regions.ts'
import { SAVED_CHOICES_HEAD, useDocumentHead } from '../head.ts'

// Saved choices: the voter's picks in ballot order, to fill in a mail
// ballot or vote at the polling place. A page of its own, one column, with
// the picked names standing out for a quick scan. Sections by level of
// government, or in paper ballot order to follow along in the booth.
// Read from the device only. There is deliberately no print, download or
// share, for any area: showing a marked ballot is against the law in
// Illinois (10 ILCS 5/29-9).

const HEADING_ID = 'saved-choices-heading'
const CLEARED_ID = 'saved-choices-cleared'

export function SavedChoicesPage() {
  const { ballot, picks } = useBallotStore()
  const [order] = useBallotOrder()

  useEffect(() => {
    document.getElementById(HEADING_ID)?.focus()
  }, [])

  useDocumentHead(SAVED_CHOICES_HEAD)

  const heading = (
    <h1
      id={HEADING_ID}
      tabIndex={-1}
      className="text-title focus:outline-none lg:text-title-lg"
    >
      Saved choices
    </h1>
  )

  if (!ballot) {
    return (
      <div className="max-w-[65ch] space-y-4">
        {heading}
        <p>
          There&apos;s no ballot saved on this device. Find your ballot, then
          check the names you pick.
        </p>
        <Link
          to={GET_STARTED_PATH}
          className="inline-flex min-h-11 items-center"
        >
          Find my ballot
        </Link>
      </div>
    )
  }

  const region = regionForElection(ballot.election.id)
  const words = (region ?? COOK).measureWords
  const sections = sectionsFor(ballot.contests, order, region ?? COOK)
  // Illinois's law against showing a marked ballot. California's differs,
  // so the warning is for Illinois ballots (and any ballot whose state isn't
  // known).
  const illinois = region?.state !== 'CA'

  return (
    <div className="max-w-[65ch] space-y-8">
      <header className="space-y-2">
        {heading}
        <p className="text-muted">
          {ballot.election.name}, {longDate(ballot.election.date)}
        </p>
        <p>You picked in {pickCountText(pickCounts(ballot, picks), words)}.</p>
      </header>

      <PickNotices />

      <BallotOrderToggle contests={ballot.contests} />

      {sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`picks-${section.id}-heading`}
          className="space-y-2"
        >
          <h2 id={`picks-${section.id}-heading`} className="text-section">
            {section.title}
          </h2>
          {section.groups ? (
            section.groups.map((group) => {
              const headingId = `picks-${section.id}-${group.id}-heading`
              return (
                <section
                  key={group.id}
                  aria-labelledby={headingId}
                  className="space-y-2 pt-4"
                >
                  <h3 id={headingId} className="text-race">
                    {group.title}
                  </h3>
                  <PickedList
                    contests={group.contests}
                    picks={picks}
                    headingLevel={4}
                  />
                </section>
              )
            })
          ) : (
            <PickedList contests={section.contests} picks={picks} />
          )}
        </section>
      ))}

      {ballot.contests.length === 0 && (
        <p>No races found for this address yet.</p>
      )}

      <div className="space-y-4 border-t border-line pt-6">
        <p className="text-small text-muted">
          Saved only on this device. This isn&apos;t an official ballot.
          {illinois &&
            " In Illinois it's against the law to show your marked ballot to anyone, including in a photo."}
        </p>
        <ClearPicks picks={picks} />
      </div>
    </div>
  )
}

function PickedList({
  contests,
  picks,
  headingLevel = 3,
}: {
  contests: Contest[]
  picks: Picks
  /** 4 inside a group that has its own h3. */
  headingLevel?: 3 | 4
}) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {contests.map((contest) => (
        <li key={contest.id} className="py-3">
          <PickedRace
            contest={contest}
            picks={picks}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * One race: its title as a quiet label, then what the voter picked in bold
 * `primary`, so the picks are what the eye finds first. Every pick looks the
 * same.
 */
function PickedRace({
  contest,
  picks,
  headingLevel,
}: {
  contest: Contest
  picks: Picks
  headingLevel: 3 | 4
}) {
  const Heading = headingLevel === 4 ? 'h4' : 'h3'
  let label: ReactNode
  let choice: ReactNode

  if (contest.kind === 'candidate') {
    const picked = pickedCandidates(picks, contest)
    label = (
      <>
        <Heading className="font-sans text-small font-semibold text-muted">
          {contest.title}
        </Heading>
        {contest.voteFor > 1 && (
          <p className="text-small text-muted">
            {picked.length} of {contest.voteFor} picked
          </p>
        )}
      </>
    )
    choice =
      picked.length > 0 ? (
        <ul className="space-y-1">
          {picked.map((c) => (
            <li key={c.name}>
              <strong className="inline-block rounded-sm bg-pick px-1.5 text-race font-bold text-on-pick forced-colors:bg-[Mark] forced-colors:text-[MarkText]">
                {c.name}
              </strong>
              {c.party && (
                <span className="block text-small text-muted">
                  <span className="sr-only">, </span>
                  {c.party}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <NoPick />
      )
  } else if (contest.kind === 'measure') {
    label = (
      <Heading className="font-sans text-small font-semibold text-muted">
        {contest.title}
      </Heading>
    )
    choice = <Answer choice={choicesFor(picks, contest)[0]} />
  } else {
    // A judge up for retention: the name is the label, Yes or No the pick.
    label = (
      <p className="text-small text-muted">
        <span className="block font-semibold">{contest.judge}</span>
        <span className="block">
          <span className="sr-only">, </span>
          {contest.office}
        </span>
      </p>
    )
    choice = <Answer choice={choicesFor(picks, contest)[0]} />
  }

  return (
    // The link wraps under the pick on narrow screens.
    <div className="flex flex-wrap items-end justify-between gap-x-4">
      <div className="min-w-0 flex-[1_1_14rem] space-y-1">
        {label}
        {choice}
      </div>
      <ShowOnBallot
        contestId={contest.id}
        name={contest.kind === 'retention' ? contest.judge : contest.title}
      />
    </div>
  )
}

function Answer({ choice }: { choice?: string }) {
  if (choice === 'yes')
    return (
      <strong className="inline-block rounded-sm bg-pick px-1.5 text-race font-bold text-on-pick forced-colors:bg-[Mark] forced-colors:text-[MarkText]">
        Yes
      </strong>
    )
  if (choice === 'no')
    return (
      <strong className="inline-block rounded-sm bg-pick px-1.5 text-race font-bold text-on-pick forced-colors:bg-[Mark] forced-colors:text-[MarkText]">
        No
      </strong>
    )
  return <NoPick />
}

function NoPick() {
  return <p className="text-muted">No pick</p>
}

/** Back to the race's place on the ballot, to change the pick there. */
function ShowOnBallot({
  contestId,
  name,
}: {
  contestId: string
  name: string
}) {
  const state: RaceLinkState = { focusId: raceAnchorId(contestId) }
  return (
    <Link
      to="/"
      state={state}
      className="inline-flex min-h-11 items-center text-small"
    >
      Show on ballot<span className="sr-only">: {name}</span>
    </Link>
  )
}

/** "Clear my picks", with a confirmation step before anything is removed. */
function ClearPicks({ picks }: { picks: Picks }) {
  const [confirming, setConfirming] = useState(false)
  const [cleared, setCleared] = useState(false)
  const clearButton = useRef<HTMLButtonElement>(null)
  const question = useRef<HTMLParagraphElement>(null)
  const total = Object.values(picks).reduce(
    (n, contests) => n + Object.keys(contests).length,
    0,
  )

  useEffect(() => {
    if (confirming) question.current?.focus()
  }, [confirming])

  return (
    <div className="space-y-3">
      {total > 0 && !confirming && (
        <button
          ref={clearButton}
          type="button"
          onClick={() => {
            setCleared(false)
            setConfirming(true)
          }}
          className="min-h-11 rounded-md border-2 border-field px-4 font-semibold text-text"
        >
          Clear my picks
        </button>
      )}
      {total > 0 && confirming && (
        <div
          role="group"
          aria-labelledby="clear-question"
          className="space-y-3 rounded-md border-2 border-field bg-surface p-4"
        >
          <p
            id="clear-question"
            ref={question}
            tabIndex={-1}
            className="font-semibold focus:outline-none"
          >
            Clear all your picks from this device? You can&apos;t undo this.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                ballotStore.clearPicks()
                setConfirming(false)
                setCleared(true)
                // The button is gone; land on the message that says why.
                setTimeout(() => document.getElementById(CLEARED_ID)?.focus())
              }}
              className="min-h-11 rounded-md border-2 border-danger px-4 font-semibold text-danger"
            >
              Yes, clear my picks
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false)
                setTimeout(() => clearButton.current?.focus())
              }}
              className="min-h-11 rounded-md border-2 border-field px-4 font-semibold text-text"
            >
              Keep my picks
            </button>
          </div>
        </div>
      )}
      <div role="status" aria-live="polite">
        {cleared && (
          <p id={CLEARED_ID} tabIndex={-1} className="focus:outline-none">
            Your picks were cleared from this device.
          </p>
        )}
      </div>
    </div>
  )
}

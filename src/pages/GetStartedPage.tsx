import { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router'
import { NOTIFY_PATH } from '../ballot/profileLinks.ts'
import { SAMPLE_BALLOTS, type SampleBallot } from '../ballot/samples.ts'
import {
  SAMPLE_HEADING_ID,
  useBallotSession,
  type FocusHeadingState,
} from '../ballot/session.ts'
import { AddressForm } from '../components/AddressForm.tsx'
import { coveredFullNames } from '../ballot/coverage.ts'
import { raceAreaPath } from '../races/paths.ts'
import { REGIONS, coveredAreas } from '../shared/regions.ts'

// /getstarted: what VoteStack is, the address form and the sample ballots.
// Where new visitors land (the ballot at / sends them here when there's no
// ballot yet) and where "Search a new address" goes. It never shows a
// ballot: a lookup or a sample opens at /. The lookup, the sample and what's
// typed live in BallotSessionProvider's memory (src/ballot/session.ts), so
// they survive going between here and the ballot; the address is never in
// the URL or browser storage.

export function GetStartedPage() {
  const { sample, leaveSample, showSample } = useBallotSession()
  const navigate = useNavigate()

  // Coming here leaves a sample, so My ballot and Back show the voter's own
  // ballot (or come back here). Not on a click: the ballot would then send
  // the visitor here itself before the link's own navigation.
  // Only the sample open when the page opens; one chosen here opens at /.
  const sampleOnOpen = useRef(sample !== null)
  useEffect(() => {
    if (!sampleOnOpen.current) return
    sampleOnOpen.current = false
    leaveSample()
  }, [leaveSample])

  function openSample(next: SampleBallot) {
    showSample(next)
    const state: FocusHeadingState = { focusHeading: SAMPLE_HEADING_ID }
    navigate('/', { state })
  }

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-title lg:text-title-lg">
          What&apos;s on your ballot?
        </h1>
        <p className="max-w-[65ch]">
          VoteStack shows you every race on your ballot with a profile for each
          candidate. It covers {coveredFullNames()}. Candidates in Los Angeles
          County don&apos;t have profiles yet.
        </p>
        <p className="max-w-[65ch]">
          Live outside {coveredAreas()}?{' '}
          <Link to={NOTIFY_PATH}>
            Get an email when VoteStack covers your area
          </Link>
          .
        </p>
        <div className="max-w-[65ch] space-y-2">
          <p>Each profile shows:</p>
          <ul className="list-disc space-y-1 ps-6">
            <li>
              Who they are, their positions, campaign financing, and
              endorsements
            </li>
            <li>Sources for each claim</li>
          </ul>
        </div>
        <p className="max-w-[65ch] text-small text-muted">
          Independent, nonpartisan, open source. Not a government site.
        </p>
      </div>

      <AddressForm samplesBelow />

      <div role="group" aria-labelledby="samples-intro" className="space-y-3">
        <p id="samples-intro" className="max-w-[65ch]">
          Or see a sample ballot:
        </p>
        <ul className="flex flex-wrap gap-2">
          {SAMPLE_BALLOTS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => openSample(s)}
                className="min-h-11 rounded-md border-2 border-field px-4 font-semibold text-text"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="max-w-[65ch]">
        Or browse{' '}
        {REGIONS.map((region, i) => (
          <span key={region.id}>
            {i > 0 && ' or '}
            <Link to={raceAreaPath(region)}>every race in {region.name}</Link>
          </span>
        ))}
        . Only your address shows which ones are on your ballot.
      </p>
    </section>
  )
}

import { useEffect, useRef } from 'react'
import {
  Link,
  Navigate,
  useLocation,
  useMatches,
  useOutlet,
} from 'react-router'
import {
  GET_STARTED_PATH,
  contestsWithPerson,
  isProfileLinkState,
  isRaceLinkState,
  type BallotOutletContext,
  type RouteHandle,
} from '../ballot/profileLinks.ts'
import {
  SAMPLE_HEADING_ID,
  isFocusHeadingState,
  useBallotSession,
  type FocusAddressState,
} from '../ballot/session.ts'
import {
  BallotView,
  ElectionHeader,
  PersonRaces,
  raceCountText,
} from '../components/BallotView.tsx'
import { WarningIcon } from '../components/icons.tsx'
import { SampleModeContext } from '../picks/sampleMode.ts'
import { useBallotStore } from '../picks/store.ts'

// My Ballot, at /: this session's lookup, a sample, or the ballot saved on
// the device. With none of them it sends the visitor to /getstarted (the
// address form), so new visitors land there. The lookup and the sample live
// in BallotSessionProvider's memory (src/ballot/session.ts); the address is
// never in the URL, browser storage or analytics, for the voter's privacy.
//
// Profiles, About, How profiles are made and Saved choices are child routes
// (routes.tsx), so this page and its ballot stay mounted while one is open.
// From 840px a profile has its race(s) beside it, and below that at its top;
// the election's name and date sit above both. For About, How profiles and
// Saved choices on every screen, the page takes the list's place.
//
// The ballot itself (its races, never the address or precinct) is saved on
// the device with the voter's picks (src/picks/store.ts), so a return visit
// opens it without the address.
//
// A sample ballot (src/ballot/samples.ts) is looked up the same way but held
// only in memory, never in the URL: it isn't saved on the device, leaves the
// voter's own ballot and picks alone and has no pick controls. A reload
// returns to the saved ballot, or to /getstarted.

const SEARCH_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-md border-2 border-field px-4 font-semibold text-text no-underline'

/**
 * "Search a new address": to the address form, focused. Opening it leaves a
 * sample (GetStartedPage), so the ballot behind it is the voter's own again.
 */
function SearchLink() {
  const state: FocusAddressState = { focusAddress: true }
  return (
    <Link to={GET_STARTED_PATH} state={state} className={SEARCH_CLASS}>
      Search a new address
    </Link>
  )
}

export function HomePage() {
  const { lookup, address, sample, sampleLookup } = useBallotSession()
  const location = useLocation()
  const inSample = sample !== null
  const saved = useBallotStore().ballot
  // This session's lookup, or the ballot saved on the device before it.
  const restored = !lookup.isSuccess && saved ? saved : undefined
  const own = lookup.isSuccess ? lookup.data : restored
  const ballot = inSample ? sampleLookup.data : own

  const context: BallotOutletContext = { ballot }
  const outlet = useOutlet(context)
  const detailOpen = outlet !== null
  const handles = useMatches().map((m) => ({
    handle: m.handle as RouteHandle | undefined,
    params: m.params,
  }))
  const detail = handles.some((m) => m.handle?.detail)
  // A candidate's page: the panel holds just their race(s), if they're on it.
  const personKey = handles.find((m) => m.handle?.racePanel)?.params.key
  const personRaces =
    ballot && personKey
      ? contestsWithPerson(ballot.contests, personKey).length > 0
      : false
  const beside =
    detailOpen && ballot !== undefined && detail && (!personKey || personRaces)
  const racePanel = beside && personRaces
  // On a profile (not its report form) the election shows above it, and
  // below 840px the race panel sits at the top of the profile so picking
  // still works on phones.
  const onProfile = handles.some((m) => m.handle?.profile)

  // From /getstarted: focus the new ballot's heading, or the sample's.
  useEffect(() => {
    if (!isFocusHeadingState(location.state)) return
    document.getElementById(location.state.focusHeading)?.focus()
  }, [location.key, location.state])

  // Back from a profile: put focus on the row the voter opened it from. A
  // race's "Show on ballot" link on Saved choices names its race instead,
  // opening the retention list if the race is in it.
  const lastRow = useRef<string | null>(null)
  useEffect(() => {
    if (isProfileLinkState(location.state))
      lastRow.current = location.state.rowId
  }, [location.state])
  useEffect(() => {
    if (detailOpen || !lastRow.current) return
    document.getElementById(lastRow.current)?.focus()
    lastRow.current = null
  }, [detailOpen])
  // Once per navigation, so coming back from a profile later still returns
  // to that profile's row.
  const shownRace = useRef<string | null>(null)
  useEffect(() => {
    if (detailOpen || !isRaceLinkState(location.state)) return
    if (shownRace.current === location.key) return
    shownRace.current = location.key
    lastRow.current = null
    const el = document.getElementById(location.state.focusId)
    const details = el?.closest('details')
    if (details) details.open = true
    el?.focus()
  }, [detailOpen, location])

  // The list stays mounted even when hidden, so nothing is lost on Back.
  // Below 840px it gives way to the profile; with no ballot (a shared
  // profile link) it's empty and hidden on every screen. Beside a profile,
  // the race panel stands in for it.
  const paneLg =
    'lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-x-hidden lg:overflow-y-auto lg:px-2 lg:pb-2'
  const paneClass = `max-lg:hidden ${paneLg}`
  const listClass = beside ? paneClass : ''

  // No ballot to show at / itself: new visitors start at the address form.
  // (A child route, like a shared profile link, still opens without one.)
  if (!detailOpen && !inSample && !own)
    return <Navigate to={GET_STARTED_PATH} replace />

  return (
    <SampleModeContext.Provider value={inSample}>
      <div
        className={
          beside
            ? 'lg:grid lg:grid-cols-[22.5rem_minmax(0,1fr)] lg:items-start lg:gap-x-10'
            : undefined
        }
      >
        {onProfile && ballot && (
          <div className="mb-6 space-y-2 lg:col-span-2">
            {sample && (
              <p className="text-small font-semibold">
                Sample ballot for the area around {sample.place}
              </p>
            )}
            <ElectionHeader ballot={ballot} />
          </div>
        )}
        {racePanel && ballot && personKey && (
          <div className={onProfile ? `max-lg:mb-6 ${paneLg}` : paneClass}>
            <PersonRaces ballot={ballot} personKey={personKey} />
          </div>
        )}
        <div
          hidden={detailOpen && (!beside || racePanel)}
          className={`@container space-y-8 ${listClass}`}
        >
          {sample && (
            <section
              aria-labelledby={SAMPLE_HEADING_ID}
              className="space-y-3 rounded-md border border-line bg-surface p-4"
            >
              <h1
                id={SAMPLE_HEADING_ID}
                tabIndex={-1}
                className="text-title text-balance focus:outline-none"
              >
                Sample ballot for the area around {sample.place}
              </h1>
              <p className="max-w-[65ch]">
                This is the ballot for one address near {sample.place}, so you
                can see how VoteStack works. Your own ballot may be different.
                You can&apos;t pick on a sample, and it isn&apos;t saved.
              </p>
              <SearchLink />
            </section>
          )}

          {!inSample && lookup.isSuccess && address && (
            <section
              aria-label="Your address"
              className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 @lg:flex-row @lg:items-center @lg:justify-between"
            >
              <p>
                <span className="block text-small text-muted">Ballot for</span>
                <span className="font-semibold">{address}</span>
              </p>
              <SearchLink />
            </section>
          )}

          {!inSample && restored && (
            <section
              aria-label="Your saved ballot"
              className="space-y-3 rounded-md border border-line bg-surface p-4"
            >
              <p className="max-w-[65ch]">
                This is the ballot you looked up before, saved on this device.
                Your address isn&apos;t saved.
              </p>
              <SearchLink />
            </section>
          )}

          {/* Announces progress, results and errors to screen readers. */}
          <div role="status" aria-live="polite">
            {inSample && sampleLookup.isPending && (
              <p className="text-muted">Loading the sample ballot…</p>
            )}
            {inSample && sampleLookup.isError && (
              <div className="flex gap-3 rounded-sm border-2 border-warn-line bg-warn-bg p-4 text-warn-fg">
                <WarningIcon />
                <p className="font-semibold">
                  Couldn&rsquo;t load the sample ballot. Check your connection
                  and try again.
                </p>
              </div>
            )}
            {inSample && sampleLookup.data && (
              <p className="sr-only">
                Showing {raceCountText(sampleLookup.data.contests)} on the
                sample ballot.
              </p>
            )}
          </div>

          {inSample && sampleLookup.isPending && <BallotSkeleton />}
          {/* On a sample its notice holds the page's h1. */}
          {ballot && (
            <BallotView ballot={ballot} titleElsewhere={beside || inSample} />
          )}
        </div>
        {detailOpen && <div className="min-w-0">{outlet}</div>}
      </div>
    </SampleModeContext.Provider>
  )
}

/** Reserves the ballot's space while it loads, so the page doesn't jump. */
function BallotSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="h-8 w-2/3 rounded-sm bg-band" />
      <div className="h-24 rounded-md bg-band" />
      <div className="h-40 rounded-md bg-band" />
      <div className="h-40 rounded-md bg-band" />
    </div>
  )
}

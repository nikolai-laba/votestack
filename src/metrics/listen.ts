// Starts the app's usage counts (src/metrics/usage.ts) once the app runs in
// a browser: the first pick in each race, links out of the site, time on
// screen, and sending the queue when the page is hidden or closed. Page
// views and ballots are counted by useUsageViews and useBallotUsage.

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { isProfileLinkState } from '../ballot/profileLinks.ts'
import { ballotStore, type SavedBallot } from '../picks/store.ts'
import { usagePage } from '../shared/metrics.ts'
import { usage, type Usage } from './usage.ts'

export function startUsage(counter: Usage = usage) {
  // ?count=off turns counting off in this browser, ?count=on back on.
  const choice = new URLSearchParams(location.search).get('count')
  if (choice === 'off' || choice === 'on') counter.setCounting(choice === 'on')

  // Report pages are kept out of search results, so a visit that starts on
  // one is almost always a scraper (one swept every report page from
  // residential proxies with a plain Chrome user agent): none of it is counted.
  if (usagePage(location.pathname).page === 'report') counter.skipPage()

  // Picks already made when the page opened are never counted again.
  const baseline = ballotStore.getSnapshot().picks
  ballotStore.subscribe(() => {
    const { ballot, picks } = ballotStore.getSnapshot()
    if (ballot) counter.picks(ballot, picks, baseline)
  })

  // A link to another site: counted by the page it was on, not where it goes.
  document.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element | null)?.closest?.('a[href]')
      if (!(link instanceof HTMLAnchorElement)) return
      if (!/^https?:$/.test(link.protocol) || link.host === location.host)
        return
      counter.out(usagePage(location.pathname).page)
    },
    { capture: true },
  )

  // Time on screen, counted when the page is hidden; then send the queue.
  let shownAt = document.visibilityState === 'visible' ? counter.clock() : null
  const hide = () => {
    if (shownAt !== null) {
      counter.active(
        counter.clock() - shownAt,
        ballotStore.getSnapshot().ballot !== null,
      )
      shownAt = null
    }
    counter.flush()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hide()
    else shownAt = counter.clock()
  })
  window.addEventListener('pagehide', hide)
}

/** Locations that send the visitor straight on (useRedirectUncounted). */
const redirecting = new Set<string>()

/**
 * For a page about to send the visitor elsewhere (`/` without a ballot goes
 * to /getstarted): it isn't counted, and the page it leads to is counted in
 * its place, as the first page opened when this one was. Layout effects run
 * before useUsageViews' effect, so the mark is always in place in time.
 */
export function useRedirectUncounted(redirects: boolean) {
  const { key } = useLocation()
  useLayoutEffect(() => {
    if (redirects) redirecting.add(key)
  }, [redirects, key])
}

/** Counts each page shown (in Layout, around every route). */
export function useUsageViews(counter: Usage = usage) {
  const location = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (redirecting.delete(location.key)) return
    const { page, key } = usagePage(location.pathname)
    const from = first.current
      ? 'landing'
      : isProfileLinkState(location.state)
        ? 'ballot'
        : 'app'
    first.current = false
    counter.view(page, from, key)
    // Once per navigation: location.key changes on each one.
  }, [location.key, location.pathname, location.state, counter])
}

/** Counts a sample ballot being shown (in HomePage), once per device. */
export function useSampleUsage(
  sample: Pick<SavedBallot, 'election'> | undefined,
  counter: Usage = usage,
) {
  useEffect(() => {
    if (sample) counter.sample(sample)
  }, [sample, counter])
}

/**
 * Counts the voter's own ballot being shown (never a sample) and profiles
 * opened beside it (in HomePage). `secsToBallot` is set for a lookup made
 * on this page.
 */
export function useBallotUsage(
  own: SavedBallot | undefined,
  openKey: string | undefined,
  secsToBallot: number | undefined,
  counter: Usage = usage,
) {
  useEffect(() => {
    if (!own) return
    counter.voter(own, secsToBallot)
    counter.catchUp(own, ballotStore.getSnapshot().picks)
  }, [own, secsToBallot, counter])
  useEffect(() => {
    if (own && openKey) counter.open(own, openKey)
  }, [own, openKey, counter])
}

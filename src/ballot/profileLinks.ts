// How the ballot and the profile pages talk to each other. The ballot stays
// in memory (BallotSessionProvider and the device store, never the URL); profiles are child routes of it, so
// it survives going to a profile and back.

import type { Ballot, Contest } from '../shared/ballot.ts'
import { profileKey } from '../shared/profile.ts'

export const profilePath = (key: string) => `/candidates/${key}`
export const reportPath = (key: string) => `/candidates/${key}/report`
/** The address form, where new visitors land (GetStartedPage). */
export const GET_STARTED_PATH = '/getstarted'
export const SAVED_CHOICES_PATH = '/saved-choices'
export const ABOUT_PATH = '/about'
/** The About page's ballot order explainer, linked from the site footer. */
export const BALLOT_ORDER_ID = 'ballot-order'

/** The element on the ballot that a race's "Show on ballot" link focuses. */
export const raceAnchorId = (contestId: string) => `race-${contestId}`

/** Router state on a link from Saved choices back to one race on the ballot. */
export interface RaceLinkState {
  focusId: string
}

export function isRaceLinkState(value: unknown): value is RaceLinkState {
  return typeof (value as Partial<RaceLinkState> | null)?.focusId === 'string'
}

/** Router state on a link from a ballot row to a profile. */
export interface ProfileLinkState {
  /** The ballot row's element id, to put focus back on it. */
  rowId: string
}

/** What HomePage hands its child routes (profile and methods pages). */
export interface BallotOutletContext {
  /** The voter's ballot, if they've looked one up this session. */
  ballot?: Ballot
}

/** Route handle (see routes.tsx, Layout and HomePage). */
export interface RouteHandle {
  /** Shown beside a panel on wide screens, in a wider page (Layout). */
  detail?: boolean
  /**
   * A candidate's page: the panel beside it holds only that candidate's
   * race(s), not the whole ballot list.
   */
  racePanel?: boolean
  /**
   * The profile itself: the election's name and date above it, and on
   * narrow screens the race panel at its top.
   */
  profile?: boolean
}

export function isProfileLinkState(value: unknown): value is ProfileLinkState {
  return typeof (value as Partial<ProfileLinkState> | null)?.rowId === 'string'
}

/**
 * The contests on a ballot that list this person: the races they run in and
 * their retention item, in ballot order.
 */
export function contestsWithPerson(
  contests: Contest[],
  personKey: string,
): Contest[] {
  return contests.filter((c) =>
    c.kind === 'candidate'
      ? c.candidates.some((p) => profileKey(p.name) === personKey)
      : c.kind === 'retention' && profileKey(c.judge) === personKey,
  )
}

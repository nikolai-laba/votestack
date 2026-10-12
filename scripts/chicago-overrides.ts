// Manual district decisions for Chicago precincts the official lists can't
// settle on their own, used by build-chicago-precincts.ts.
// Precinct ("ward-precinct") → layer → map district (OCD-ID, or "none" for
// outside every district) → the district to use instead. Two districts mean
// the precinct is split and we can't tell which addresses are in which part:
// voters see both races with a note, rather than possibly missing one.
// Each entry says why. Vote counts are from the March 17, 2026 primary.

import type { OcdId } from '../src/shared/ballot.ts'

const IL = 'ocd-division/country:us/state:il'
const COOK = 'ocd-division/country:us/state:il/county:cook'
const SCHOOL =
  'ocd-division/country:us/state:il/place:chicago/school_board_district'

export const CHICAGO_OVERRIDES: Record<
  string,
  Record<string, Record<string, OcdId | OcdId[]>>
> = {
  // The Board lists 11-1 in state senate 3 and 12 and state house 6 and 24
  // (3 and 3 voters in 3 and 6; 89 and 101 in 12 and 24). Our maps put all
  // 525 address points in 12 and 24, so the few voters in 3 and 6 can't be
  // placed.
  '11-1': {
    'state senate': { [`${IL}/sldu:12`]: [`${IL}/sldu:12`, `${IL}/sldu:3`] },
    'state house': { [`${IL}/sldl:24`]: [`${IL}/sldl:24`, `${IL}/sldl:6`] },
  },
  // The Board's school board schedule splits 3-2 between 6B and 10A; our map
  // puts all 166 address points in 6B. School board races weren't on the
  // primary ballot, so there are no counts to say how big the 10A part is.
  '3-2': {
    'chicago school board': {
      [`${SCHOOL}:6b`]: [`${SCHOOL}:6b`, `${SCHOOL}:10a`],
    },
  },
  // Precincts where the March 2026 primary's vote counts show the
  // whole precinct voting in a race our maps give only part of it. Shares are
  // the race's voters / Board President voters, divided by the race's usual
  // ratio citywide (data/raw/chicago/primary-2026-dem-shares.json).
  // 42-14: 103% voted in Board of Review 2; maps put 62% of addresses in 3.
  '42-14': {
    'board of review': {
      [`${COOK}/board_of_review_district:3`]: `${COOK}/board_of_review_district:2`,
    },
  },
  // 11-19: 92% voted in state senate 12 (73 voters); maps put 54% in 1.
  '11-19': {
    'state senate': { [`${IL}/sldu:1`]: `${IL}/sldu:12` },
  },
  // 11-20: 105% voted in the 8th subcircuit and none in the 5th, although
  // the Board lists both; maps put addresses in the 5th and 14th.
  '11-20': {
    'judicial subcircuit': {
      [`${COOK}/judicial_subcircuit:5`]: `${COOK}/judicial_subcircuit:8`,
      [`${COOK}/judicial_subcircuit:14`]: `${COOK}/judicial_subcircuit:8`,
    },
  },
}

/**
 * Listed districts no address should get, already reviewed: the Board lists
 * the precinct in the district, but the primary's vote counts show no voters
 * there. Precinct → layer → districts.
 */
export const CHICAGO_NO_VOTERS: Record<string, Record<string, OcdId[]>> = {
  // 11-20: 0 of 257 primary voters voted in the 5th subcircuit (see above).
  '11-20': { 'judicial subcircuit': [`${COOK}/judicial_subcircuit:5`] },
}

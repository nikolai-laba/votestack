// Calendar dates in Chicago time. Every date VoteStack shows (a profile's
// "Updated", a source's "Viewed") is a Chicago date, so work done on a Chicago
// evening (already the next day in UTC) is dated the day it happened.

import type { IsoDate } from './ballot.ts'

export const CHICAGO_TIME_ZONE = 'America/Chicago'

/** The Chicago calendar date of a moment as `YYYY-MM-DD` (today by default). */
export function chicagoDate(at: Date | string = new Date()): IsoDate {
  // en-CA formats dates as YYYY-MM-DD.
  return new Date(at).toLocaleDateString('en-CA', {
    timeZone: CHICAGO_TIME_ZONE,
  })
}

/** True for a calendar date (`YYYY-MM-DD`), false for a full timestamp. */
export const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

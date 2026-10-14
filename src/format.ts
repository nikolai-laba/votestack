// Formatting shared by the ballot and profile views.

import { CHICAGO_TIME_ZONE, isIsoDate } from './shared/dates.ts'

const LONG_DATE: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}

/**
 * "Tuesday, November 3, 2026". A calendar date (`YYYY-MM-DD`) is shown as
 * that day wherever the reader is; a full timestamp is shown as its date in
 * Chicago, so an evening update isn't dated the next day (UTC).
 */
export function longDate(iso: string): string {
  if (isIsoDate(iso)) {
    const [year, month, day] = iso.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
      'en-US',
      { ...LONG_DATE, timeZone: 'UTC' },
    )
  }
  return new Date(iso).toLocaleDateString('en-US', {
    ...LONG_DATE,
    timeZone: CHICAGO_TIME_ZONE,
  })
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** "$48,210" */
export const money = (amount: number) => USD.format(amount)

/**
 * "42%" from 0.42, in whole percents. A share that would round to 0% or
 * 100% without being all or nothing says "Under 1%" or "Over 99%".
 */
export function percent(share: number): string {
  if (share > 0 && share < 0.005) return 'Under 1%'
  if (share < 1 && share >= 0.995) return 'Over 99%'
  return `${Math.round(share * 100)}%`
}

/**
 * A link from profile or ballot data, only when it's an ordinary web
 * address (http or https). Anything else gets no link at all, so data can
 * never put a script or another kind of link on the page.
 */
export function webUrl(url: string | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

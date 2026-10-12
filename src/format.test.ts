import { afterEach, describe, expect, it } from 'vitest'
import { longDate } from './format.ts'

const zone = process.env.TZ

describe('longDate', () => {
  afterEach(() => {
    process.env.TZ = zone
  })

  it('shows a calendar date as that day in any time zone', () => {
    for (const tz of ['America/Chicago', 'Pacific/Honolulu', 'Asia/Tokyo']) {
      process.env.TZ = tz
      expect(longDate('2026-11-03')).toBe('Tuesday, November 3, 2026')
    }
  })

  it('shows a timestamp as its date in Chicago', () => {
    // 9 p.m. CDT on October 6 is October 7 in UTC.
    expect(longDate('2026-10-07T02:00:00.000Z')).toBe(
      'Tuesday, October 6, 2026',
    )
    expect(longDate('2026-10-06T15:00:00Z')).toBe('Tuesday, October 6, 2026')
  })
})

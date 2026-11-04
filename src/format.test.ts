import { afterEach, describe, expect, it } from 'vitest'
import { longDate, longDateIn, longDateTime, webUrl } from './format.ts'

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

describe('webUrl', () => {
  it('keeps web addresses and drops every other kind of link', () => {
    expect(webUrl('https://ilga.gov/')).toBe('https://ilga.gov/')
    expect(webUrl('HTTP://example.com')).toBe('HTTP://example.com')
    expect(webUrl('javascript:alert(1)')).toBeUndefined()
    expect(webUrl('data:text/html,hi')).toBeUndefined()
    expect(webUrl(' https://x')).toBeUndefined()
    expect(webUrl(undefined)).toBeUndefined()
  })
})

describe('longDateTime', () => {
  it('shows minutes in the zone given', () => {
    expect(longDateTime('2026-11-04T08:12:00Z', 'America/Chicago', 'CT')).toBe(
      'Wednesday, November 4, 2026, 2:12 a.m. CT',
    )
  })

  it('drops :00 on the hour', () => {
    expect(
      longDateTime('2026-11-06T00:00:00Z', 'America/Los_Angeles', 'PT'),
    ).toBe('Thursday, November 5, 2026, 4 p.m. PT')
  })
})

describe('longDateIn', () => {
  it("shows the instant's date in the zone given", () => {
    expect(longDateIn('2026-11-04T03:41:00Z', 'America/Chicago')).toBe(
      'Tuesday, November 3, 2026',
    )
  })

  it('uses the previous local day for a late-evening UTC instant', () => {
    expect(longDateIn('2026-11-04T07:59:00Z', 'America/Los_Angeles')).toBe(
      'Tuesday, November 3, 2026',
    )
    expect(longDateIn('2026-11-04T08:00:00Z', 'America/Los_Angeles')).toBe(
      'Wednesday, November 4, 2026',
    )
  })
})

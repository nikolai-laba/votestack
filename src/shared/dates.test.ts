import { describe, expect, it } from 'vitest'
import { chicagoDate, isIsoDate } from './dates.ts'

describe('chicagoDate', () => {
  it('dates a Chicago evening by its Chicago day, not the UTC one', () => {
    // 9 p.m. CDT on October 6 is already October 7 in UTC.
    expect(chicagoDate(new Date('2026-10-07T02:00:00Z'))).toBe('2026-10-06')
    expect(chicagoDate('2026-10-07T02:00:00Z')).toBe('2026-10-06')
  })

  it('moves to the next day at Chicago midnight', () => {
    expect(chicagoDate('2026-10-07T04:59:59Z')).toBe('2026-10-06')
    expect(chicagoDate('2026-10-07T05:00:00Z')).toBe('2026-10-07')
    // Standard time (CST, UTC-6) after November 1.
    expect(chicagoDate('2026-11-04T05:30:00Z')).toBe('2026-11-03')
  })

  it('returns a calendar date', () => {
    expect(isIsoDate(chicagoDate())).toBe(true)
  })
})

describe('isIsoDate', () => {
  it('tells calendar dates from timestamps', () => {
    expect(isIsoDate('2026-10-06')).toBe(true)
    expect(isIsoDate('2026-10-06T15:00:00Z')).toBe(false)
  })
})

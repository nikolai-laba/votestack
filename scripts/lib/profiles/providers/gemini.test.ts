import { describe, expect, it } from 'vitest'
import { dailyLimit, outOfCredit } from './gemini.ts'

describe('Gemini API limits', () => {
  it('moves to Vertex on credit or quota errors, not on per-minute limits', () => {
    expect(
      outOfCredit(
        429,
        'RESOURCE_EXHAUSTED: You exceeded your current quota, please check your plan and billing details.',
      ),
    ).toBeInstanceOf(Error)
    expect(
      outOfCredit(
        429,
        'Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel',
      ),
    ).toBeInstanceOf(Error)
    expect(
      outOfCredit(
        403,
        'PERMISSION_DENIED: billing account has no prepaid credit',
      ),
    ).toBeInstanceOf(Error)
    expect(
      outOfCredit(
        429,
        'Quota exceeded for metric GenerateRequestsPerMinutePerProjectPerModel',
      ),
    ).toBeUndefined()
    expect(outOfCredit(500, 'Internal error')).toBeUndefined()
    expect(outOfCredit(403, 'URL not allowed')).toBeUndefined()
  })

  it('still stops at the daily cap when no fallback is set', () => {
    expect(
      dailyLimit(429, 'GenerateRequestsPerDayPerProjectPerModel'),
    ).toBeInstanceOf(Error)
    expect(dailyLimit(429, 'PerMinute')).toBeUndefined()
  })
})

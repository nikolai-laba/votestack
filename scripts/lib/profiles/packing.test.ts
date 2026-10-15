// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { dailyLimit, GeminiDailyLimitError } from './providers/gemini.ts'
import { packByUrls } from './providers/staged.ts'
import {
  checkerInstructions,
  packedCheckerInstructions,
  packedCheckerMessage,
} from './staged.ts'
import type { ProfileRequest } from './prompt.ts'

const req: ProfileRequest = {
  key: 'jane-doe',
  electionId: 'il-2026-11-03-general',
  name: 'Jane Doe',
  office: 'State Senator, 3rd District',
  contestIds: ['c1'],
  kind: 'candidate',
  tier: 'mid',
  officeType: 'state_legislature',
  asOf: '2026-10-14',
}

describe('dailyLimit', () => {
  it('stops on a per-day quota, not on other 429s', () => {
    expect(
      dailyLimit(
        429,
        '{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel"}]}}',
      ),
    ).toBeInstanceOf(GeminiDailyLimitError)
    expect(
      dailyLimit(429, '{"quotaId":"GenerateRequestsPerMinutePerProject"}'),
    ).toBeUndefined()
    expect(dailyLimit(503, 'per day')).toBeUndefined()
  })
})

describe('packByUrls', () => {
  const item = (...urls: string[]) => ({ urls: new Set(urls) })
  it('packs in order within the size and page limits', () => {
    const a = item('1', '2')
    const b = item('2', '3')
    const c = item('4', '5', '6')
    expect(packByUrls([a, b, c], 2)).toEqual([[a, b], [c]])
    expect(packByUrls([a, b, c], 3, 4)).toEqual([[a, b], [c]])
    expect(packByUrls([a, b, c], 3)).toEqual([[a, b, c]])
  })
})

describe('packedCheckerInstructions', () => {
  it('keeps every rule of the single check and asks for one answer per candidate', () => {
    const single = checkerInstructions(req)
    const packed = packedCheckerInstructions(req, 2)
    const rules = single.slice(
      single.indexOf('## For every sentence'),
      single.indexOf('## Output'),
    )
    expect(packed).toContain(rules)
    expect(packed).toContain("2 candidates' profiles in the same race")
    expect(packed).toContain('"candidates": [{"candidate": 1')
  })

  it('numbers each candidate’s draft', () => {
    const message = packedCheckerMessage([
      { req, sentences: [] },
      { req: { ...req, key: 'john-roe', name: 'John Roe' }, sentences: [] },
    ])
    expect(message).toContain('# Candidate 1 of 2')
    expect(message).toContain('# Candidate 2 of 2')
    expect(message).toContain('Candidate: John Roe')
  })
})

import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { COOK } from '../../../src/shared/regions.ts'
import { ROOT } from '../data.ts'
import { AREAS } from './files.ts'

// Cook County's current election has moved on to a later one.
vi.mock('../../../src/shared/cook.ts', async (original) => ({
  ...(await original<typeof import('../../../src/shared/cook.ts')>()),
  CURRENT_ELECTION: {
    id: 'il-2027-02-23-municipal',
    name: 'Consolidated Election',
    date: '2027-02-23',
    divisionId: 'ocd-division/country:us/state:il',
  },
}))

describe('AREAS', () => {
  it('names each area’s 2026 election outright, whatever election is current', () => {
    expect(COOK.election.id).toBe('il-2027-02-23-municipal')
    expect(AREAS.map((a) => [a.id, a.election.id, a.election.date])).toEqual([
      ['cook', 'il-2026-11-03-general', '2026-11-03'],
      ['ca-la', 'ca-2026-11-03-general', '2026-11-03'],
    ])
  })

  it('writes each area’s results to content/results/{election ID}.json', () => {
    for (const area of AREAS)
      expect(area.out).toBe(
        join(ROOT, 'content', 'results', `${area.election.id}.json`),
      )
  })
})

import { describe, expect, it } from 'vitest'
import {
  form460Summary,
  lateSince,
  latestReport,
  type Form460,
} from './form460.ts'

const where = {
  filedWith: 'California Secretary of State',
  url: 'https://example.gov/c/1',
}

const report = (over: Partial<Form460> = {}): Form460 => ({
  committee: 'Gipson for Board of Equalization 2026',
  from: '2026-07-01',
  through: '2026-09-19',
  summary: {
    monetary: 100_200,
    loans: 20_000,
    nonmonetary: 0,
    total: 120_200,
    cashOnHand: 80_000,
  },
  byCode: { IND: 60_000, COM: 30_000, PTY: 5_000, OTH: 4_700, SCC: 0 },
  unitemized: 500,
  fromCandidate: 1_000,
  loansFromCandidate: 15_000,
  ...over,
})

describe('form460Summary', () => {
  it('sorts line 5 by contributor code, with the candidate’s gifts and loans together', () => {
    const s = form460Summary(report(), where)
    expect(s).toMatchObject({
      source: 'CA',
      filedWith: 'California Secretary of State',
      period: 'July 1 to September 19, 2026',
      raised: 120_200,
      cashOnHand: 80_000,
      fromCandidate: 16_000,
    })
    expect(s.breakdown).toEqual([
      { kind: 'small', amount: 500 },
      { kind: 'large', amount: 59_000 },
      { kind: 'pac', amount: 30_000 },
      { kind: 'party', amount: 5_000 },
      { kind: 'candidate', amount: 16_000 },
      { kind: 'loan', amount: 5_000 },
      { kind: 'other', amount: 4_700 },
    ])
  })

  it('shows no breakdown when the parts don’t add up to line 5, or there are no items', () => {
    expect(
      form460Summary(report({ unitemized: 9_000 }), where).breakdown,
    ).toBeUndefined()
    expect(
      form460Summary(report({ byCode: undefined }), where).breakdown,
    ).toBeUndefined()
  })
})

describe('lateSince', () => {
  it('counts late contributions after the period, never naming anyone', () => {
    expect(
      lateSince('2026-09-19', [
        { date: '2026-09-18', amount: 5_000, code: 'COM' },
        { date: '2026-10-02', amount: 2_500, code: 'IND' },
        {
          date: '2026-10-09',
          amount: 10_000,
          code: 'IND',
          fromCandidate: true,
        },
      ]),
    ).toEqual({
      since: '2026-09-19',
      total: 12_500,
      count: 2,
      fromCandidate: 10_000,
    })
    expect(lateSince('2026-09-19', [])).toBeUndefined()
  })
})

describe('latestReport', () => {
  it('takes the latest period, then the latest filing', () => {
    const a = report({ through: '2026-06-30' })
    const b = report({ through: '2026-09-19', filedOn: '2026-09-24' })
    const c = report({ through: '2026-09-19', filedOn: '2026-10-01' })
    expect(latestReport([a, b, c])).toBe(c)
  })
})

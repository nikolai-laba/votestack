import { describe, expect, it } from 'vitest'
import {
  fecDate,
  fecSummary,
  matchFecCandidates,
  parseCandidates,
  parseCommittees,
  parseCsvLine,
  type FecData,
} from './fec.ts'
import { parseBallotName } from './names.ts'

const CANDIDATES = `Link_Image,Cand_Name,Cand_Id,Cand_Office,Cand_Office_St,Cand_Office_Dist,Total_Receipt
"x","FOSTER, G. WILLIAM (BILL)","H8IL14067","H","IL","11","2180937.41"
"x","FOSTER, JANE","H6IL05999","H","IL","05","10"
"x","STRATTON, JULIANA","S6IL00458","S","IL","00","5906598.55"
"x","SMITH, JOHN","H6GA14300","H","GA","14","0"
`

const COMMITTEES = `CMTE_ID,CMTE_NM,CMTE_DSGN,CAND_ID,TTL_RECEIPTS,COH_COP,INDV_ITEM_CONTB,INDV_UNITEM_CONTB,PTY_CMTE_CONTB,OTH_CMTE_CONTB,TRANF_FROM_OTHER_AUTH_CMTE,CAND_CNTB,CAND_LOAN,OTH_LOANS,OFFSETS_TO_OP_EXP,OTHER_RECEIPTS,CVG_START_DT,CVG_END_DT
"C00435099","BILL FOSTER FOR CONGRESS","P","H8IL14067","2180937.41","2505288.27","1066669.65","131181.52","0","900000","50000","0","0","0","30000","3086.24","20250101","20260630"
"C00999999","FOSTER VICTORY FUND","J","H8IL14067","50000","100","0","0","0","0","0","0","0","0","0","0","20250101","20260630"
"C00888888","STRATTON FOR ILLINOIS","P","S6IL00458","1002600.50","1107958.01","50","50","0","0","0","2500.50","1000000","0","0","0","20250424","20260630"
"C00777777","JANE FOSTER FOR CONGRESS","P","H6IL05999","1000","10","2000","0","0","0","0","0","0","0","0","0","20250101","20260630"
`

describe('parseCsvLine', () => {
  it('handles quoted commas and escaped quotes', () => {
    expect(parseCsvLine('"a, b","say ""hi""",,c')).toEqual([
      'a, b',
      'say "hi"',
      '',
      'c',
    ])
  })
})

describe('fecDate', () => {
  it('reads both FEC date styles', () => {
    expect(fecDate('20260630')).toBe('2026-06-30')
    expect(fecDate('06302026')).toBe('2026-06-30')
    expect(fecDate('06/30/2026')).toBe('2026-06-30')
    expect(fecDate('')).toBe('')
  })
})

describe('FEC summaries', () => {
  const candidates = parseCandidates(CANDIDATES)
  const ids = new Set(candidates.map((c) => c.id))
  const data: FecData = {
    candidates,
    committees: parseCommittees(COMMITTEES, ids),
  }

  it('keeps Illinois House and Senate candidates only', () => {
    expect(candidates.map((c) => c.id)).toEqual([
      'H8IL14067',
      'H6IL05999',
      'S6IL00458',
    ])
  })

  it('matches by seat and name', () => {
    const bill = parseBallotName('Bill Foster')
    expect(
      matchFecCandidates(bill, { office: 'H', district: 11 }, candidates).map(
        (c) => c.id,
      ),
    ).toEqual(['H8IL14067'])
    expect(
      matchFecCandidates(bill, { office: 'H', district: 5 }, candidates),
    ).toEqual([])
  })

  it("breaks the principal committee's receipts down by source", () => {
    expect(fecSummary(candidates[0], data)).toEqual({
      source: 'FEC',
      committee: 'BILL FOSTER FOR CONGRESS',
      url: 'https://www.fec.gov/data/committee/C00435099/?cycle=2026',
      period: 'January 1, 2025 to June 30, 2026',
      raised: 2180937.41,
      cashOnHand: 2505288.27,
      breakdown: [
        { kind: 'small', amount: 131181.52 },
        { kind: 'large', amount: 1066669.65 },
        { kind: 'pac', amount: 900000 },
        { kind: 'transfer', amount: 50000 },
        { kind: 'other', amount: 33086.24 },
      ],
    })
  })

  it("counts the candidate's own contributions and loans once", () => {
    const stratton = fecSummary(candidates[2], data)
    expect(stratton?.fromCandidate).toBe(1002500.5)
    expect(stratton?.breakdown).toEqual([
      { kind: 'small', amount: 50 },
      { kind: 'large', amount: 50 },
      { kind: 'candidate', amount: 1002500.5 },
    ])
    expect(fecSummary(candidates[0], data)).not.toHaveProperty('fromCandidate')
  })

  it("leaves the breakdown out when the parts don't add up", () => {
    expect(fecSummary(candidates[1], data)).not.toHaveProperty('breakdown')
  })

  it('returns nothing without a principal committee', () => {
    expect(fecSummary({ ...candidates[1], id: 'H0IL00000' }, data)).toBeNull()
  })
})

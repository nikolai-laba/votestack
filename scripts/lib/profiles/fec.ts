// Campaign money for federal races (U.S. Senate and House) from the Federal
// Election Commission's bulk data files, which need no API key:
//   candidate_summary_2026.csv  one row per candidate (name, office, district)
//   committee_summary_2026.csv  one row per committee: cycle-to-date totals
//                               from the latest report, line by line
// See https://www.fec.gov/data/browse-data/?tab=bulk-data. Donors are never
// read: the summaries hold only totals.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  MoneySourceKind,
  MoneySummary,
} from '../../../src/shared/profile.ts'
import { cachedDownload } from './download.ts'
import { namesMatch, splitCommaName, type ParsedName } from './names.ts'
import { breakdownOf, cents, formatPeriod } from './seats.ts'

export const FEC_CYCLE = 2026
const BULK = `https://www.fec.gov/files/bulk-downloads/${FEC_CYCLE}`
export const FEC_FILES = [
  `candidate_summary_${FEC_CYCLE}.csv`,
  `committee_summary_${FEC_CYCLE}.csv`,
]

export async function downloadFec(dir: string, maxAgeHours: number) {
  for (const file of FEC_FILES)
    await cachedDownload(`${BULK}/${file}`, join(dir, file), maxAgeHours)
}

/** One CSV line, with quoted fields ("a, b" and "" escapes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(field)
      field = ''
    } else field += c
  }
  out.push(field)
  return out
}

/** Rows of a CSV file with a header line, as objects. */
export function csvRecords(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']))
  })
}

export interface FecCandidate {
  id: string
  /** As filed: "SCHNEIDER, BRADLEY S." */
  name: string
  office: 'H' | 'S'
  district: number
  /**
   * The FEC's incumbent/challenger/open-seat field for this cycle
   * (Cand_Incumbent_Challenger_Open_Seat): I, C, O, or '' when not given.
   */
  status: 'I' | 'C' | 'O' | ''
}

export interface FecCommittee {
  id: string
  name: string
  candidateId: string
  /** P = principal campaign committee. */
  designation: string
  url: string
  receipts: number
  cashOnHand: number
  /**
   * `receipts` by kind of source, from the lines of the committee's Form 3
   * (cycle to date):
   * - small: 11(a)(ii) unitemized contributions from individuals
   * - large: 11(a)(i) itemized contributions from individuals
   * - pac: 11(c) other political committees
   * - party: 11(b) political party committees
   * - transfer: 12 transfers from other authorized committees (joint
   *   fundraising committees included)
   * - candidate: 11(d) contributions plus 13(a) loans from the candidate
   * - loan: 13(b) all other loans
   * - other: 14 offsets to operating expenditures (refunds, rebates) plus
   *   15 other receipts (such as interest)
   */
  parts: Record<MoneySourceKind, number>
  /** YYYY-MM-DD */
  coverageStart: string
  coverageEnd: string
}

const num = (s: string | undefined) => Number(s?.replace(/[$,]/g, '') || 0)

/** "20250101" (summaries), "06302026" or "01/01/2025" → "2025-01-01" */
export function fecDate(s: string): string {
  if (/^(19|20)\d{6}$/.test(s))
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`
  if (/^\d{8}$/.test(s))
    return `${s.slice(4)}-${s.slice(0, 2)}-${s.slice(2, 4)}`
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : ''
}

/** "INCUMBENT" (summary file) or "I" (master file) → "I"; anything else → ''. */
export function fecStatus(s: string | undefined): FecCandidate['status'] {
  const c = (s ?? '').trim().toUpperCase()
  if (c === 'I' || c === 'INCUMBENT') return 'I'
  if (c === 'C' || c === 'CHALLENGER') return 'C'
  if (c === 'O' || c === 'OPEN') return 'O'
  return ''
}

export function parseCandidates(csv: string, state = 'IL'): FecCandidate[] {
  return csvRecords(csv)
    .filter(
      (r) =>
        r.Cand_Office_St === state &&
        (r.Cand_Office === 'H' || r.Cand_Office === 'S'),
    )
    .map((r) => ({
      id: r.Cand_Id,
      name: r.Cand_Name,
      office: r.Cand_Office as 'H' | 'S',
      district: Number(r.Cand_Office_Dist || 0),
      status: fecStatus(r.Cand_Incumbent_Challenger_Open_Seat),
    }))
}

export function parseCommittees(
  csv: string,
  candidateIds: Set<string>,
): FecCommittee[] {
  return csvRecords(csv)
    .filter((r) => candidateIds.has(r.CAND_ID))
    .map((r) => ({
      id: r.CMTE_ID,
      name: r.CMTE_NM,
      candidateId: r.CAND_ID,
      designation: r.CMTE_DSGN,
      url: `https://www.fec.gov/data/committee/${r.CMTE_ID}/?cycle=${FEC_CYCLE}`,
      receipts: num(r.TTL_RECEIPTS),
      cashOnHand: num(r.COH_COP),
      parts: {
        small: num(r.INDV_UNITEM_CONTB),
        large: num(r.INDV_ITEM_CONTB),
        pac: num(r.OTH_CMTE_CONTB),
        party: num(r.PTY_CMTE_CONTB),
        transfer: num(r.TRANF_FROM_OTHER_AUTH_CMTE),
        candidate: num(r.CAND_CNTB) + num(r.CAND_LOAN),
        loan: num(r.OTH_LOANS),
        other: num(r.OFFSETS_TO_OP_EXP) + num(r.OTHER_RECEIPTS),
      },
      coverageStart: fecDate(r.CVG_START_DT),
      coverageEnd: fecDate(r.CVG_END_DT),
    }))
}

export interface FecData {
  candidates: FecCandidate[]
  committees: FecCommittee[]
}

export async function loadFec(dir: string, state = 'IL'): Promise<FecData> {
  const candidates = parseCandidates(
    await readFile(join(dir, `candidate_summary_${FEC_CYCLE}.csv`), 'latin1'),
    state,
  )
  const ids = new Set(candidates.map((c) => c.id))
  return {
    candidates,
    committees: parseCommittees(
      await readFile(join(dir, `committee_summary_${FEC_CYCLE}.csv`), 'latin1'),
      ids,
    ),
  }
}

/** FEC candidates for a seat whose name matches the ballot name. */
export function matchFecCandidates(
  ballot: ParsedName,
  seat: { office: 'H' | 'S'; district?: number },
  candidates: FecCandidate[],
): FecCandidate[] {
  return candidates.filter((c) => {
    if (c.office !== seat.office) return false
    if (seat.office === 'H' && c.district !== seat.district) return false
    const { last, first } = splitCommaName(c.name)
    return namesMatch(ballot, last, first)
  })
}

/** The candidate's principal campaign committee: the one with the latest report, then the most money. */
export function principalCommittee(
  candidateId: string,
  committees: FecCommittee[],
): FecCommittee | undefined {
  return committees
    .filter((c) => c.candidateId === candidateId && c.designation === 'P')
    .sort(
      (a, b) =>
        b.coverageEnd.localeCompare(a.coverageEnd) || b.receipts - a.receipts,
    )[0]
}

/** Cycle-to-date totals from the committee's latest report. */
export function fecSummary(
  candidate: FecCandidate,
  data: FecData,
): MoneySummary | null {
  const committee = principalCommittee(candidate.id, data.committees)
  if (!committee || !committee.coverageEnd) return null
  const summary: MoneySummary = {
    source: 'FEC',
    committee: committee.name,
    url: committee.url,
    period: formatPeriod(
      committee.coverageStart || `${FEC_CYCLE - 1}-01-01`,
      committee.coverageEnd,
    ),
    raised: committee.receipts,
    cashOnHand: committee.cashOnHand,
  }
  const breakdown = breakdownOf(committee.receipts, committee.parts)
  if (breakdown) summary.breakdown = breakdown
  if (committee.parts.candidate > 0)
    summary.fromCandidate = cents(committee.parts.candidate)
  return summary
}

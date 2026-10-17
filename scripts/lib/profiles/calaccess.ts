// Campaign money for California state offices and judges from Cal-Access,
// the Secretary of State's campaign filing database. The SOS publishes the
// whole database once a day as one zip of tab-separated tables
// (https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip, about 1.6 GB;
// table layouts in the zip's DBInfo and CalFormat folders). The zip is
// cached whole and only the tables used here are streamed out of it with
// `unzip -p`:
//
// - F501_502_CD: candidate intention statements (Form 501), which name the
//   office, district, election year and the candidate's committee.
// - CVR_CAMPAIGN_DISCLOSURE_CD: Form 460 and 497 cover pages (committee,
//   period, filing date, and on the 460 the candidate's name and office).
// - SMRY_CD: Form 460 summary page lines (column A is the period).
// - RCPT_CD: Schedule A and C items, summed by contributor code.
// - LOAN_CD: Schedule B part 1 loans, for loans from the candidate.
// - S497_CD: Form 497 late contributions received.
// - LOOKUP_CODES_CD: the district codes used on Form 501.
//
// Every filing can be amended; the latest amendment (highest AMEND_ID) of
// each filing is the one used. Donor names are read only to tell whether a
// gift came from the candidate and are never kept.
//
// The format is pinned to the export as published in October 2026. The SOS
// plans to replace Cal-Access with a new system in mid-November 2026, after
// the general election; expect this export to change or stop then.

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { IsoDate } from '../../../src/shared/ballot.ts'
import { cachedDownload } from './download.ts'
import {
  form460Summary,
  lateSince,
  type ContributorCode,
  type Form460,
  type LateContribution,
} from './form460.ts'
import { isCandidateGiver } from './isbe.ts'
import type {
  MoneyContext,
  MoneyEntry,
  MoneyPerson,
  MoneyResult,
} from './money-ca.ts'
import { namesMatch, type ParsedName } from './names.ts'

export const CALACCESS_URL =
  'https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip'
export const ZIP_NAME = 'dbwebexport.zip'
export const FILED_WITH = 'California Secretary of State'

export const committeeUrl = (id: string) =>
  `https://cal-access.sos.ca.gov/Campaign/Committees/Detail.aspx?id=${id}`
export const candidateUrl = (id: string) =>
  `https://cal-access.sos.ca.gov/Campaign/Candidates/Detail.aspx?id=${id}`

export async function downloadCalAccess(dir: string, maxAgeHours: number) {
  await cachedDownload(CALACCESS_URL, join(dir, ZIP_NAME), maxAgeHours)
}

// ---------------------------------------------------------------------------
// Reading tables

export type Row = Record<string, string>

/** The lines of one table in the export zip, streamed. */
export async function* tableLines(
  zip: string,
  table: string,
): AsyncGenerator<string> {
  const child = spawn('unzip', ['-p', zip, `CalAccess/DATA/${table}.TSV`])
  const exited = new Promise<number | null>((resolve) =>
    child.on('close', resolve),
  )
  child.stdout.setEncoding('latin1')
  yield* createInterface({ input: child.stdout, crlfDelay: Infinity })
  const code = await exited
  if (code !== 0) throw new Error(`unzip ${table} exited with ${code}`)
}

/**
 * Rows of a tab-separated table with a header line. `keep` sees the first
 * column (FILING_ID in the filing tables) before the line is split, so a
 * pass over a large table stays quick.
 */
export async function* tsvRows(
  lines: AsyncIterable<string> | Iterable<string>,
  keep?: (first: string) => boolean,
): AsyncGenerator<Row> {
  let header: string[] | null = null
  for await (const line of lines) {
    if (header === null) {
      header = line.split('\t').map((h) => h.trim())
      continue
    }
    if (!line) continue
    if (keep && !keep(line.slice(0, line.indexOf('\t')))) continue
    const cells = line.split('\t')
    const row: Row = {}
    header.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()))
    yield row
  }
}

/** "9/24/2026 12:00:00 AM" → "2026-09-24"; '' when it isn't a date. */
export function calDate(s: string): IsoDate | '' {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return ''
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

const amount = (s: string | undefined) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** Keeps each filing's latest amendment. */
export function latestAmendments<
  T extends { filingId: string; amendId: number },
>(rows: T[]): T[] {
  const best = new Map<string, T>()
  for (const r of rows) {
    const b = best.get(r.filingId)
    if (!b || r.amendId > b.amendId) best.set(r.filingId, r)
  }
  return [...best.values()]
}

// ---------------------------------------------------------------------------
// Statements (Form 501) and cover pages

export interface Statement {
  filingId: string
  amendId: number
  /** The candidate's own filer ID. */
  candidateId: string
  /** The committee the candidate named, if any. */
  committeeId: string
  last: string
  first: string
  office: string
  district?: number
  year: number
}

export interface Cover {
  filingId: string
  amendId: number
  form: 'F460' | 'F497'
  /** The committee's filer ID. */
  filerId: string
  /** CTL (candidate-controlled), RCP (recipient committee), ... */
  entity: string
  committee: string
  filedOn: IsoDate | ''
  from: IsoDate | ''
  through: IsoDate | ''
  candLast: string
  candFirst: string
  office: string
  officeText: string
  district?: number
}

const districtNumber = (s: string | undefined) => {
  const m = (s ?? '').match(/\d+/)
  return m ? Number(m[0]) : undefined
}

/** Form 501s for one election year, latest amendment of each. */
export function readStatements(
  rows: Row[],
  districtCodes: Map<string, string>,
  year: number,
): Statement[] {
  const out: Statement[] = []
  for (const r of rows) {
    if (r.FORM_TYPE !== 'F501' || Number(r.YR_OF_ELEC) !== year) continue
    out.push({
      filingId: r.FILING_ID,
      amendId: Number(r.AMEND_ID),
      candidateId: r.FILER_ID,
      committeeId: r.COMMITTEE_ID,
      last: r.CAND_NAML,
      first: [r.CAND_NAMF, r.MONIKER && `(${r.MONIKER})`]
        .filter(Boolean)
        .join(' '),
      office: r.OFFICE_CD,
      district: districtNumber(
        r.DIST_NO || districtCodes.get(r.DISTRICT_CD) || '',
      ),
      year,
    })
  }
  return latestAmendments(out)
}

/** Form 460 and 497 cover pages filed on or after `since`, latest amendment of each. */
export function readCovers(rows: Row[], since: IsoDate): Cover[] {
  const out: Cover[] = []
  for (const r of rows) {
    if (r.FORM_TYPE !== 'F460' && r.FORM_TYPE !== 'F497') continue
    const filedOn = calDate(r.RPT_DATE)
    if (!filedOn || filedOn < since) continue
    out.push({
      filingId: r.FILING_ID,
      amendId: Number(r.AMEND_ID),
      form: r.FORM_TYPE,
      filerId: r.FILER_ID,
      entity: r.ENTITY_CD,
      committee: [r.FILER_NAMF, r.FILER_NAML].filter(Boolean).join(' '),
      filedOn,
      from: calDate(r.FROM_DATE),
      through: calDate(r.THRU_DATE),
      candLast: r.CAND_NAML,
      candFirst: r.CAND_NAMF,
      office: r.OFFICE_CD,
      officeText: r.OFFIC_DSCR,
      district: districtNumber(r.DIST_NO),
    })
  }
  return latestAmendments(out)
}

// ---------------------------------------------------------------------------
// Which office a person runs for, in Cal-Access's codes

export interface Seat {
  /** Form 501 office codes (LOOKUP_CODES_CD 30000s). */
  statementCodes: string[]
  /** Cover page office codes. */
  coverCodes: string[]
  district?: number
  /** Judges: covers often code the office as "other", so a judge-like description or committee name also counts. */
  judge?: boolean
  retention?: boolean
}

const STATEWIDE: [RegExp, string, string][] = [
  [/lieutenant governor/i, '30003', 'LTG'],
  [/governor/i, '30002', 'GOV'],
  [/secretary of state/i, '30004', 'SOS'],
  [/controller/i, '30005', 'CON'],
  [/treasurer/i, '30006', 'TRE'],
  [/attorney general/i, '30007', 'ATT'],
  [/superintendent of public instruction/i, '30008', 'SUP'],
  [/insurance commissioner/i, '30014', 'INS'],
]

/** Judge, Supreme Court judge, appellate court judge, superior court judge. */
const JUDGE_CODES = ['30015', '30053', '30057', '30059']

export function seatOf(p: MoneyPerson): Seat | null {
  const district = Number(p.districtId.match(/:(\d+)$/)?.[1])
  switch (p.officeType) {
    case 'statewide': {
      const hit = STATEWIDE.find(([re]) => re.test(p.office))
      return hit ? { statementCodes: [hit[1]], coverCodes: [hit[2]] } : null
    }
    case 'state_legislature':
      if (/\/sldl:\d+$/.test(p.districtId))
        return { statementCodes: ['30013'], coverCodes: ['ASM'], district }
      if (/\/sldu:\d+$/.test(p.districtId))
        return { statementCodes: ['30012'], coverCodes: ['SEN'], district }
      return null
    case 'board_of_equalization':
      return { statementCodes: ['30009'], coverCodes: ['BOE'], district }
    case 'judicial_candidate':
      return {
        statementCodes: JUDGE_CODES,
        coverCodes: ['SCJ', 'APP'],
        judge: true,
      }
    case 'retention':
      return {
        statementCodes: JUDGE_CODES,
        coverCodes: ['SCJ', 'APP'],
        judge: true,
        retention: true,
      }
    default:
      return null
  }
}

/**
 * Names on filings, by namesMatch: as filed, with a spaced last name run
 * together ("De Jute" for "Dejute"), by a middle name the person goes by,
 * or a whole name entered in the last-name field ("Pat Smith"). Callers
 * check the office too.
 */
export function sameName(
  ballot: ParsedName,
  last: string,
  first: string,
): boolean {
  if (!first.trim()) {
    const whole = last.trim().split(/\s+/)
    if (whole.length < 2) return false
    return namesMatch(ballot, whole.at(-1)!, whole.slice(0, -1).join(' '))
  }
  if (!last.trim()) return false
  const lasts = /\s/.test(last.trim())
    ? [last, last.replace(/\s+/g, '')]
    : [last]
  // Someone who goes by a middle name ("Erica Araceli" on the ballot as
  // "Araceli"): the ballot's given name equals a later first-name word.
  const middle = first
    .toLowerCase()
    .split(/[^a-z]+/)
    .slice(1)
    .filter((w) => w.length >= 3 && ballot.given.includes(w))
  return lasts.some(
    (l) =>
      namesMatch(ballot, l, first) ||
      middle.some((w) => namesMatch(ballot, l, w, { strictGiven: true })),
  )
}

const JUDGE_WORDS = /judge|court|justice/i

/** Cover-page entity codes of a candidate's own committee (CAO appears on some by mistake). */
const CONTROLLED = new Set(['CTL', 'CAO'])

function coverFitsSeat(c: Cover, seat: Seat): boolean {
  if (seat.judge)
    return (
      seat.coverCodes.includes(c.office) ||
      JUDGE_WORDS.test(c.officeText) ||
      /judge|justice/i.test(c.committee)
    )
  if (!seat.coverCodes.includes(c.office)) return false
  return seat.district === undefined || c.district === seat.district
}

/** Committees that aren't a campaign for this election: officeholder accounts, legal defense funds, or another year's race. */
function otherPurpose(name: string, year: number): boolean {
  if (/office ?holder|legal defense|ballot measure/i.test(name)) return true
  const years = [...name.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1]))
  return years.length > 0 && !years.includes(year)
}

/** Independent expenditure committees name the candidate too; these words mark them. */
const NOT_THE_CANDIDATES =
  /support|oppos|independent|sponsored|\bIE\b|coalition|alliance|association/i

export type CommitteeMatch =
  | { kind: 'committee'; id: string; candidateId?: string }
  | { kind: 'statement-only'; candidateIds: string[] }
  | { kind: 'none' }
  | { kind: 'ambiguous'; ids: string[] }

/**
 * The person's campaign committee for this office and year, from the
 * candidate's own records: committees named on their Form 501 for the
 * office (and district), and controlled committees whose Form 460 cover
 * pages name them as the candidate for that office. A committee counts only
 * if its own cover pages this cycle are for this office (a Form 501 can
 * name a committee that is still reporting for another race), or if it has
 * filed no Form 460 yet. When several remain, the one still reporting this
 * year is taken if there's just one; otherwise it's ambiguous. Never the
 * largest.
 */
export function matchCommittee(
  p: MoneyPerson,
  seat: Seat,
  statements: Statement[],
  covers: Cover[],
  year: number,
): CommitteeMatch {
  const mine = statements.filter(
    (s) =>
      seat.statementCodes.includes(s.office) &&
      (seat.district === undefined || s.district === seat.district) &&
      sameName(p.ballot, s.last, s.first),
  )
  const reports = new Map<string, Cover[]>()
  const latest = new Map<string, Cover>()
  for (const c of covers) {
    const b = latest.get(c.filerId)
    if (!b || c.filedOn > b.filedOn) latest.set(c.filerId, c)
    if (c.form !== 'F460') continue
    const list = reports.get(c.filerId) ?? []
    list.push(c)
    reports.set(c.filerId, list)
  }
  const nameOf = (id: string) => latest.get(id)?.committee ?? ''
  const usable = (id: string) => !otherPurpose(nameOf(id), year)
  const fits = (id: string) =>
    (reports.get(id) ?? []).some((c) => coverFitsSeat(c, seat))
  const reportsThisYear = (id: string) =>
    (reports.get(id) ?? []).some((c) => c.through >= `${year}-01-01`)

  const candidateIds = [...new Set(mine.map((s) => s.candidateId))]
  const candidateId = candidateIds.length === 1 ? candidateIds[0] : undefined
  const pick = (ids: Set<string>): CommitteeMatch | null => {
    const ok = [...ids].filter(usable).sort()
    if (ok.length === 1) return { kind: 'committee', id: ok[0], candidateId }
    if (ok.length === 0) return null
    const current = ok.filter(reportsThisYear)
    if (current.length === 1)
      return { kind: 'committee', id: current[0], candidateId }
    return { kind: 'ambiguous', ids: ok }
  }

  const named = new Set(mine.map((s) => s.committeeId).filter(Boolean))
  const onCovers = covers.filter(
    (c) =>
      c.form === 'F460' &&
      coverFitsSeat(c, seat) &&
      sameName(p.ballot, c.candLast, c.candFirst),
  )
  const controlled = new Set(
    onCovers.filter((c) => CONTROLLED.has(c.entity)).map((c) => c.filerId),
  )
  const reporting = new Set([...named, ...controlled].filter(fits))
  const byRecords = pick(reporting)
  if (byRecords) return byRecords

  // Some candidates' own committees file as plain recipient committees;
  // count one only when its name is the candidate's ("Smith for Judge",
  // "Smith 4 Assembly").
  const last = p.ballot.words.at(-1) ?? ''
  const ownNamed = new Set(
    onCovers
      .filter((c) => {
        const name = nameOf(c.filerId)
        return (
          !CONTROLLED.has(c.entity) &&
          name.toLowerCase().replace(/\s+/g, '').includes(last) &&
          !NOT_THE_CANDIDATES.test(name)
        )
      })
      .map((c) => c.filerId),
  )
  const byName = pick(ownNamed)
  if (byName) return byName

  // A committee named on the Form 501 that hasn't filed a Form 460 yet.
  const fresh = pick(new Set([...named].filter((id) => !reports.has(id))))
  if (fresh) return fresh
  if (candidateIds.length) return { kind: 'statement-only', candidateIds }
  return { kind: 'none' }
}

// ---------------------------------------------------------------------------
// Report contents

export interface SmryLine {
  filingId: string
  amendId: number
  form: string
  line: string
  a: number
}

export interface ReceiptItem {
  filingId: string
  amendId: number
  form: string
  code: string
  amount: number
  last: string
  first: string
  memo: boolean
}

export interface LoanItem {
  filingId: string
  amendId: number
  form: string
  code: string
  /** Received this period, less paid back or forgiven this period (as the summary's line 2 counts loans). */
  net: number
  last: string
  first: string
  memo: boolean
}

export interface LateItem {
  filingId: string
  amendId: number
  form: string
  code: string
  date: IsoDate | ''
  amount: number
  last: string
  first: string
  memo: boolean
}

/** A form a filer filed, from the filing index (which also lists paper filings). */
export interface FiledForm {
  filerId: string
  form: string
  filedOn: IsoDate | ''
}

export interface Items {
  smry: SmryLine[]
  receipts: ReceiptItem[]
  loans: LoanItem[]
  late: LateItem[]
  /** The filing index for committees with no e-filed Form 460 this cycle. */
  filed: FiledForm[]
}

const isMemo = (s: string | undefined) => (s ?? '').toUpperCase() === 'X'

export const filedForm = (r: Row): FiledForm => ({
  filerId: r.FILER_ID,
  form: r.FORM_ID,
  filedOn: calDate(r.FILING_DATE),
})

export const smryLine = (r: Row): SmryLine => ({
  filingId: r.FILING_ID,
  amendId: Number(r.AMEND_ID),
  form: r.FORM_TYPE,
  line: r.LINE_ITEM,
  a: amount(r.AMOUNT_A),
})

export const receiptItem = (r: Row): ReceiptItem => ({
  filingId: r.FILING_ID,
  amendId: Number(r.AMEND_ID),
  form: r.FORM_TYPE,
  code: r.ENTITY_CD,
  amount: amount(r.AMOUNT),
  last: r.CTRIB_NAML,
  first: r.CTRIB_NAMF,
  memo: isMemo(r.MEMO_CODE),
})

export const loanItem = (r: Row): LoanItem => ({
  filingId: r.FILING_ID,
  amendId: Number(r.AMEND_ID),
  form: r.FORM_TYPE,
  code: r.ENTITY_CD,
  net: amount(r.LOAN_AMT1) - amount(r.LOAN_AMT5) - amount(r.LOAN_AMT6),
  last: r.LNDR_NAML,
  first: r.LNDR_NAMF,
  memo: isMemo(r.MEMO_CODE),
})

export const lateItem = (r: Row): LateItem => ({
  filingId: r.FILING_ID,
  amendId: Number(r.AMEND_ID),
  form: r.FORM_TYPE,
  code: r.ENTITY_CD,
  date: calDate(r.CTRIB_DATE),
  amount: amount(r.AMOUNT),
  last: r.ENTY_NAML,
  first: r.ENTY_NAMF,
  memo: isMemo(r.MEMO_CODE),
})

const CODES: ContributorCode[] = ['IND', 'COM', 'OTH', 'PTY', 'SCC']
const contributorCode = (code: string): ContributorCode =>
  CODES.includes(code as ContributorCode)
    ? (code as ContributorCode)
    : code === 'RCP'
      ? 'COM'
      : 'OTH'

/**
 * One Form 460 from its cover and items. Null when Cal-Access has no summary
 * page for it (paper filings have a cover only).
 */
export function buildForm460(
  cover: Cover,
  items: Items,
  candidate: ParsedName,
): Form460 | null {
  const of = <T extends { filingId: string; amendId: number }>(rows: T[]) =>
    rows.filter(
      (r) => r.filingId === cover.filingId && r.amendId === cover.amendId,
    )
  const smry = of(items.smry)
  const line = (form: string, n: string) =>
    smry.find((s) => s.form === form && s.line === n)
  const total = line('F460', '5')
  if (!total || !cover.from || !cover.through) return null
  const value = (form: string, n: string) => line(form, n)?.a ?? 0

  const byCode: Partial<Record<ContributorCode, number>> = {}
  let fromCandidate = 0
  for (const r of of(items.receipts)) {
    if (r.memo || (r.form !== 'A' && r.form !== 'C')) continue
    const code = contributorCode(r.code)
    byCode[code] = (byCode[code] ?? 0) + r.amount
    if (code === 'IND' && isCandidateGiver(candidate, r.last, r.first))
      fromCandidate += r.amount
  }
  let loansFromCandidate = 0
  for (const l of of(items.loans))
    if (
      !l.memo &&
      l.form === 'B1' &&
      l.code === 'IND' &&
      isCandidateGiver(candidate, l.last, l.first)
    )
      loansFromCandidate += l.net

  // Unitemized gifts are Schedule A line 2 (money) and C line 2 (in kind);
  // without Schedule A's own summary the split can't be checked.
  const hasScheduleA = !!line('A', '2') || value('F460', '1') === 0
  return {
    committee: cover.committee,
    committeeId: cover.filerId,
    from: cover.from,
    through: cover.through,
    ...(cover.filedOn && { filedOn: cover.filedOn }),
    summary: {
      monetary: value('F460', '1'),
      loans: value('F460', '2'),
      nonmonetary: value('F460', '4'),
      total: total.a,
      ...(line('F460', '16') && { cashOnHand: value('F460', '16') }),
    },
    byCode,
    ...(hasScheduleA && { unitemized: value('A', '2') + value('C', '2') }),
    ...(fromCandidate > 0 && { fromCandidate }),
    ...(loansFromCandidate !== 0 && { loansFromCandidate }),
  }
}

/** Contributions received on Form 497s (part 1), latest amendment of each. */
export function lateContributions(
  covers: Cover[],
  items: Items,
  candidate: ParsedName,
): LateContribution[] {
  const wanted = new Set(covers.map((c) => `${c.filingId}|${c.amendId}`))
  return items.late
    .filter(
      (r) =>
        wanted.has(`${r.filingId}|${r.amendId}`) &&
        r.form === 'F497P1' &&
        !r.memo &&
        r.date,
    )
    .map((r) => {
      const code = contributorCode(r.code)
      return {
        date: r.date as IsoDate,
        amount: r.amount,
        code,
        ...(code === 'IND' &&
          isCandidateGiver(candidate, r.last, r.first) && {
            fromCandidate: true,
          }),
      }
    })
}

// ---------------------------------------------------------------------------
// Putting it together

export interface CalAccessBase {
  statements: Statement[]
  covers: Cover[]
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "2026-01-30" → "January 30, 2026". */
const longDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return `${MONTHS[m - 1]} ${day}, ${y}`
}

const RETENTION_NOTE =
  'No campaign committee on file with the Secretary of State.'

/**
 * Money for each person from Cal-Access. `loadItems` reads the summary
 * lines and items of the given filings (all amendments), and the filing
 * index of the given filers.
 */
export async function collectCalAccess(
  people: MoneyPerson[],
  base: CalAccessBase,
  loadItems: (filingIds: Set<string>, filerIds: Set<string>) => Promise<Items>,
  ctx: Pick<MoneyContext, 'year'>,
): Promise<MoneyResult> {
  const result: MoneyResult = { byKey: {}, unmatched: [] }
  const miss = (p: MoneyPerson, reason: string) =>
    result.unmatched.push({
      key: p.key,
      name: p.name,
      office: p.office,
      reason,
    })
  const cycleStart = `${ctx.year - 1}-01-01`

  const chosen: {
    p: MoneyPerson
    id: string
    report: Cover
    late: Cover[]
  }[] = []
  const unreported: { p: MoneyPerson; id: string; committee: string }[] = []
  for (const p of people) {
    const seat = seatOf(p)
    if (!seat) {
      miss(p, `No Cal-Access office code for "${p.office}"`)
      continue
    }
    const m = matchCommittee(p, seat, base.statements, base.covers, ctx.year)
    if (m.kind === 'ambiguous') {
      miss(
        p,
        `Several Cal-Access committees could be theirs: ${m.ids.join(', ')}`,
      )
      continue
    }
    if (m.kind === 'none') {
      if (seat.retention)
        result.byKey[p.key] = { summaries: [], note: RETENTION_NOTE }
      else
        miss(
          p,
          `No ${ctx.year} candidate statement (Form 501) or campaign committee in Cal-Access for this name and office`,
        )
      continue
    }
    if (m.kind === 'statement-only') {
      result.byKey[p.key] = {
        summaries: [],
        ...(m.candidateIds.length === 1 && {
          filingsAt: {
            name: FILED_WITH,
            url: candidateUrl(m.candidateIds[0]),
          },
        }),
        note: `Filed a statement of intention to run (Form 501) for ${ctx.year}, but no campaign committee is on file with the Secretary of State.`,
      }
      continue
    }
    const mineCovers = base.covers.filter((c) => c.filerId === m.id)
    const report = mineCovers
      .filter((c) => c.form === 'F460' && c.from && c.through >= cycleStart)
      .sort(
        (a, b) =>
          b.through.localeCompare(a.through) ||
          b.filedOn.localeCompare(a.filedOn),
      )[0]
    const committee =
      [...mineCovers].sort((a, b) => b.filedOn.localeCompare(a.filedOn))[0]
        ?.committee ?? m.id
    if (!report) {
      unreported.push({ p, id: m.id, committee })
      continue
    }
    const late = mineCovers.filter(
      (c) => c.form === 'F497' && c.filedOn > report.through,
    )
    chosen.push({ p, id: m.id, report, late })
  }

  const items = await loadItems(
    new Set(
      chosen.flatMap((c) => [c.report, ...c.late].map((r) => r.filingId)),
    ),
    new Set(unreported.map((u) => u.id)),
  )
  for (const { p, id, committee } of unreported) {
    // Paper filings are in the filing index but have no cover or figures.
    const paper = items.filed
      .filter(
        (f) => f.filerId === id && f.form === 'F460' && f.filedOn >= cycleStart,
      )
      .sort((a, b) => b.filedOn.localeCompare(a.filedOn))[0]
    result.byKey[p.key] = {
      summaries: [],
      matchedCommittee: id,
      filingsAt: { name: committee, url: committeeUrl(id) },
      note: paper
        ? `The committee's latest Form 460 (filed ${longDate(paper.filedOn)}) was filed on paper, so its figures aren't in the Secretary of State's data.`
        : `Campaign committee on file with the Secretary of State, with no Form 460 report for ${ctx.year - 1}–${ctx.year} yet.`,
    }
  }
  for (const { p, id, report, late } of chosen) {
    const where = { filedWith: FILED_WITH, url: committeeUrl(id) }
    const f460 = buildForm460(report, items, p.ballot)
    if (!f460) {
      result.byKey[p.key] = {
        summaries: [],
        matchedCommittee: id,
        filingsAt: { name: report.committee, url: where.url },
        note: `The latest Form 460 (through ${longDate(report.through)}) has no summary figures in Cal-Access's data; it may have been filed on paper.`,
      }
      continue
    }
    const summary = form460Summary(f460, where)
    const since = lateSince(
      f460.through,
      lateContributions(late, items, p.ballot),
    )
    const entry: MoneyEntry = {
      summaries: [{ ...summary, ...(since && { largeSince: since }) }],
      matchedCommittee: id,
    }
    result.byKey[p.key] = entry
  }
  return result
}

/** Reads the tables needed to match people, from the cached zip. */
export async function loadBase(
  zip: string,
  year: number,
): Promise<CalAccessBase> {
  const districtCodes = new Map<string, string>()
  for await (const r of tsvRows(tableLines(zip, 'LOOKUP_CODES_CD')))
    if (r.CODE_TYPE === '17000') districtCodes.set(r.CODE_ID, r.CODE_DESC)
  const statementRows: Row[] = []
  for await (const r of tsvRows(tableLines(zip, 'F501_502_CD')))
    statementRows.push(r)
  // Only this cycle's covers are kept; the table goes back to 2000.
  const since = `${year - 1}-01-01`
  const coverRows: Row[] = []
  for await (const r of tsvRows(tableLines(zip, 'CVR_CAMPAIGN_DISCLOSURE_CD')))
    if (
      (r.FORM_TYPE === 'F460' || r.FORM_TYPE === 'F497') &&
      calDate(r.RPT_DATE) >= since
    )
      coverRows.push(r)
  return {
    statements: readStatements(statementRows, districtCodes, year),
    covers: readCovers(coverRows, since),
  }
}

/** Reads the summary lines and items of the given filings, and the filing index of the given filers, from the cached zip. */
export async function loadItems(
  zip: string,
  filingIds: Set<string>,
  filerIds: Set<string>,
): Promise<Items> {
  const read = async <T>(
    table: string,
    map: (r: Row) => T,
    ids: Set<string> = filingIds,
  ) => {
    const out: T[] = []
    for await (const r of tsvRows(tableLines(zip, table), (id) => ids.has(id)))
      out.push(map(r))
    return out
  }
  return {
    smry: await read('SMRY_CD', smryLine),
    receipts: await read('RCPT_CD', receiptItem),
    loans: await read('LOAN_CD', loanItem),
    late: await read('S497_CD', lateItem),
    filed:
      filerIds.size > 0
        ? await read('FILER_FILINGS_CD', filedForm, filerIds)
        : [],
  }
}

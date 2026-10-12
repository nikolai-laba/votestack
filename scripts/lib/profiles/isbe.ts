// Campaign money for state and local races from the Illinois State Board of
// Elections' campaign disclosure data files
// (https://www.elections.il.gov/CampaignDisclosureDataFiles/, tab-separated,
// refreshed daily). Committees file D-2 quarterly reports (due 15 days after
// each quarter ends) and A-1 reports of contributions of $1,000 or more
// between quarterlies.
//
// The files include donors' and candidates' home addresses. They're read once
// in a streaming pass and only candidates' names and offices and the reports'
// totals are kept; nothing about donors leaves this module except sums.

import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { MoneySummary } from '../../../src/shared/profile.ts'
import { cachedDownload } from './download.ts'
import { namesMatch, splitCommaName, type ParsedName } from './names.ts'
import { breakdownOf, cents, formatPeriod, type Seat } from './seats.ts'

const FILES_URL = 'https://www.elections.il.gov/CampaignDisclosureDataFiles'
export const ISBE_FILES = [
  'Candidates.txt',
  'CanElections.txt',
  'CmteCandidateLinks.txt',
  'Committees.txt',
  'D2Totals.txt',
  'FiledDocs.txt',
  'Receipts.txt',
]

export const committeeUrl = (id: string) =>
  `https://www.elections.il.gov/CampaignDisclosure/CommitteeDetail.aspx?ID=${id}`

export async function downloadIsbe(dir: string, maxAgeHours: number) {
  for (const file of ISBE_FILES)
    await cachedDownload(`${FILES_URL}/${file}`, join(dir, file), maxAgeHours)
}

/**
 * Streams a tab-separated file with a header line. Rows whose field count
 * doesn't match the header (a stray tab or line break in a free-text field)
 * are skipped and counted.
 */
export async function readTsv(
  path: string,
  onRow: (row: Record<string, string>) => void,
): Promise<{ rows: number; skipped: number }> {
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  })
  let header: string[] | null = null
  let rows = 0
  let skipped = 0
  for await (const line of lines) {
    const cells = line.split('\t')
    if (!header) {
      header = cells.map((h) => h.replace(/^﻿/, '').trim())
      continue
    }
    if (cells.length !== header.length) {
      if (line.trim()) skipped++
      continue
    }
    const row: Record<string, string> = {}
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i].trim()
    onRow(row)
    rows++
  }
  return { rows, skipped }
}

export interface IsbeCandidate {
  id: string
  lastName: string
  firstName: string
  office: string
  districtType: string
  district: string
  /** County of residence, as filed (not the address). */
  residenceCounty: string
  /** Election years with a candidacy record. */
  years: Set<number>
}

export interface IsbeCommittee {
  id: string
  name: string
  type: string
  active: boolean
  /**
   * Linked to three or more different candidates, like the Committee for
   * Retention of Judges in Cook County: not any one candidate's money.
   */
  shared: boolean
}

export interface IsbeReport {
  id: string
  committeeId: string
  kind: 'Quarterly' | 'A-1'
  /** YYYY-MM-DD */
  start: string
  end: string
  filed: string
}

export interface IsbeTotals {
  receipts: number
  endFunds: number
  /** D-2 Part 1, itemized and not. */
  individualItemized: number
  individualUnitemized: number
  /** Part 2 transfers in, Part 3 loans and Part 4 other receipts, itemized and not. */
  transfers: number
  loans: number
  other: number
}

/** True when a filing's office and district fit the seat on the ballot. */
export function isbeOfficeFits(
  seat: Seat,
  c: Pick<
    IsbeCandidate,
    'office' | 'districtType' | 'district' | 'residenceCounty'
  >,
): boolean {
  const o = c.office.toLowerCase()
  const t = c.districtType.toLowerCase()
  const d = c.district.toLowerCase()
  const n = Number.parseInt(d, 10)
  switch (seat.level) {
    case 'federal':
      return false
    case 'state':
      // Some records give the county instead of the district number.
      if (seat.office === 'representative')
        return (
          t === 'representative' && (n === seat.district || Number.isNaN(n))
        )
      if (seat.office === 'senator')
        return t === 'senate' && (n === seat.district || Number.isNaN(n))
      if (t !== 'statewide') return false
      if (seat.office === 'governor') return /^governor/.test(o)
      return o.includes(seat.office)
    case 'county':
      if (seat.office === 'board president')
        return o === 'president' && t === 'county board' && d.includes('cook')
      if (seat.office === 'commissioner')
        return (
          (/^comm?iss?ioner|^commssioner/.test(o) && t.startsWith('county')) ||
          (o === 'member' &&
            t === 'county board' &&
            (d.includes('cook') || c.residenceCounty.toLowerCase() === 'cook'))
        )
      if (seat.office === 'board of review')
        return o.includes('board of review') || t.includes('board of review')
      return o.startsWith(seat.office) && t === 'county' && d.includes('cook')
    case 'mwrd':
      return (
        t === 'water reclamation' &&
        o.startsWith('commissioner') &&
        !d.includes('north shore')
      )
    case 'judge':
      // Cook County's circuit and subcircuits, or the First Appellate District.
      return (
        o.includes('judge') &&
        (d.includes('cook') ||
          c.residenceCounty.toLowerCase() === 'cook' ||
          (t === 'appellate court' && n === 1))
      )
    case 'school board':
      // "Chicago 2B", "Chicago 10" or just the subdistrict, "1A".
      return (
        t === 'school' && (d.includes('chicago') || /^\d{1,2}[ab]$/.test(d))
      )
  }
}

export interface IsbeIndex {
  candidates: IsbeCandidate[]
  /** Candidate ID → committee IDs. */
  links: Map<string, string[]>
  committees: Map<string, IsbeCommittee>
}

export async function loadIsbeIndex(dir: string): Promise<IsbeIndex> {
  const byId = new Map<string, IsbeCandidate>()
  // Only names and offices are kept; candidates' addresses are dropped here.
  await readTsv(join(dir, 'Candidates.txt'), (r) =>
    byId.set(r.ID, {
      id: r.ID,
      lastName: r.LastName,
      firstName: r.FirstName,
      office: r.Office,
      districtType: r.DistrictType,
      district: r.District,
      residenceCounty: r.ResidenceCounty,
      years: new Set(),
    }),
  )
  await readTsv(join(dir, 'CanElections.txt'), (r) =>
    byId.get(r.CandidateID)?.years.add(Number(r.ElectionYear)),
  )
  const links = new Map<string, string[]>()
  await readTsv(join(dir, 'CmteCandidateLinks.txt'), (r) => {
    const list = links.get(r.CandidateID) ?? []
    list.push(r.CommitteeID)
    links.set(r.CandidateID, list)
  })
  const committees = new Map<string, IsbeCommittee>()
  await readTsv(join(dir, 'Committees.txt'), (r) =>
    committees.set(r.ID, {
      id: r.ID,
      name: r.Name,
      type: r.TypeOfCommittee,
      active: r.Status === 'A',
      shared: false,
    }),
  )
  const people = new Map<string, Set<string>>()
  for (const [candidateId, ids] of links)
    for (const id of ids) {
      const set = people.get(id) ?? new Set<string>()
      set.add(byId.get(candidateId)?.lastName.toLowerCase() ?? candidateId)
      people.set(id, set)
    }
  for (const [id, set] of people) {
    const committee = committees.get(id)
    if (committee && set.size >= 3) committee.shared = true
  }
  return { candidates: [...byId.values()], links, committees }
}

/**
 * ISBE candidate records for a ballot name and seat. The record needs an
 * election record for `year`, or none at all (candidates added after the
 * primary often have none yet). Judges up for retention don't file a
 * candidacy, so any judicial record counts for them.
 */
export function matchIsbeCandidates(
  ballot: ParsedName,
  seat: Seat,
  candidates: IsbeCandidate[],
  year: number,
): IsbeCandidate[] {
  const retention = seat.level === 'judge' && seat.retention
  // A legislative district pins the seat down, so a one-letter typo in the
  // filed last name is allowed there.
  const typoInLastName = 'district' in seat
  return candidates.filter(
    (c) =>
      (retention || c.years.has(year) || c.years.size === 0) &&
      isbeOfficeFits(seat, c) &&
      namesMatch(ballot, c.lastName, c.firstName, {
        typoInLastName: typoInLastName && /^\d/.test(c.district),
      }),
  )
}

/**
 * A candidate's own committee. Older committees have no type on file; PACs,
 * party and independent expenditure committees aren't a candidate's money.
 */
const isCandidateCommittee = (c: IsbeCommittee) =>
  c.type === 'Candidate' || c.type === ''

/** Active committees linked to these records that aren't the candidate's own (shared ones and PACs). */
export function otherCommitteesFor(
  matches: IsbeCandidate[],
  index: Pick<IsbeIndex, 'links' | 'committees'>,
): IsbeCommittee[] {
  const ids = new Set(matches.flatMap((m) => index.links.get(m.id) ?? []))
  return [...ids]
    .map((id) => index.committees.get(id))
    .filter(
      (c): c is IsbeCommittee =>
        !!c && c.active && (c.shared || !isCandidateCommittee(c)),
    )
}

/** The candidate's own active committees linked to these records, typed candidate committees first. */
export function committeesFor(
  matches: IsbeCandidate[],
  index: Pick<IsbeIndex, 'links' | 'committees'>,
): IsbeCommittee[] {
  const ids = new Set(matches.flatMap((m) => index.links.get(m.id) ?? []))
  return [...ids]
    .map((id) => index.committees.get(id))
    .filter(
      (c): c is IsbeCommittee =>
        !!c && c.active && !c.shared && isCandidateCommittee(c),
    )
    .sort(
      (a, b) =>
        Number(b.type === 'Candidate') - Number(a.type === 'Candidate') ||
        Number(b.id) - Number(a.id),
    )
}

/** Committees for party posts, not public office. */
const PARTY_OFFICE =
  /committee ?(wo)?man|committeeperson|committee person|state central|ward (democratic|republican)|township/i

/**
 * Fallback when no record fits the seat: ISBE keeps one candidate record per
 * committee, often for whatever office the committee was first set up for
 * (an incumbent senator's record may say "Committee Person"). Accepts the
 * person's candidate committees when the name matches, the record is in Cook
 * County, and the committee's own name contains the candidate's last name or
 * a given name ("Friends of Ram"), leaving out committees for party posts.
 */
export function committeesByName(
  ballot: ParsedName,
  index: IsbeIndex,
): IsbeCommittee[] {
  const lastWord = ballot.words[ballot.words.length - 1]
  const givenWords = ballot.given.filter((g) => g.length >= 3)
  const namesPerson = (name: string) => {
    const w = name
      .normalize('NFKD')
      .toLowerCase()
      .split(/[^a-z]+/)
    return (
      name
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        .includes(lastWord) || givenWords.some((g) => w.includes(g))
    )
  }
  const ids = new Set<string>()
  for (const c of index.candidates) {
    const inCook =
      c.residenceCounty.toLowerCase() === 'cook' ||
      /chicago|cook/i.test(c.district)
    if (!inCook || !namesMatch(ballot, c.lastName, c.firstName)) continue
    for (const id of index.links.get(c.id) ?? []) ids.add(id)
  }
  return [...ids]
    .map((id) => index.committees.get(id))
    .filter(
      (c): c is IsbeCommittee =>
        !!c &&
        c.active &&
        !c.shared &&
        c.type === 'Candidate' &&
        !PARTY_OFFICE.test(c.name) &&
        namesPerson(c.name),
    )
}

const isoDate = (s: string) => s.slice(0, 10)

/** Money as filed, rounded to cents (some amounts carry stray fractions). */
const amountOf = (s: string) => cents(Number(s))

/** Current (not superseded) quarterly and A-1 reports of the given committees. */
export async function loadReports(
  dir: string,
  committeeIds: Set<string>,
): Promise<IsbeReport[]> {
  const out: IsbeReport[] = []
  await readTsv(join(dir, 'FiledDocs.txt'), (r) => {
    if (!committeeIds.has(r.CommitteeID) || r.Archived === 'True') return
    if (r.DocName !== 'Quarterly' && r.DocName !== 'A-1') return
    out.push({
      id: r.ID,
      committeeId: r.CommitteeID,
      kind: r.DocName,
      start: isoDate(r.RptPdBegDate),
      end: isoDate(r.RptPdEndDate),
      filed: isoDate(r.RcvdDateTime),
    })
  })
  return out
}

/** The latest quarterly report that covers a period ending on or before `today`. */
export function latestQuarterly(
  reports: IsbeReport[],
  committeeId: string,
  today: string,
): IsbeReport | undefined {
  return reports
    .filter(
      (r) =>
        r.committeeId === committeeId &&
        r.kind === 'Quarterly' &&
        r.end &&
        r.end <= today,
    )
    .sort(
      (a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed),
    )[0]
}

export async function loadTotals(
  dir: string,
  reportIds: Set<string>,
): Promise<Map<string, IsbeTotals>> {
  const out = new Map<string, IsbeTotals>()
  await readTsv(join(dir, 'D2Totals.txt'), (r) => {
    if (!reportIds.has(r.FiledDocID) || r.Archived === 'True') return
    out.set(r.FiledDocID, {
      receipts: amountOf(r.TotalReceipts),
      endFunds: amountOf(r.EndFundsAvail),
      individualItemized: amountOf(r.IndivContribI),
      individualUnitemized: amountOf(r.IndivContribNI),
      transfers: amountOf(r.XferInI) + amountOf(r.XferInNI),
      loans: amountOf(r.LoanRcvI) + amountOf(r.LoanRcvNI),
      other: amountOf(r.OtherRctI) + amountOf(r.OtherRctNI),
    })
  })
  return out
}

/** Words that mark a contributor as an organization, never the candidate. */
const ORGANIZATION_WORDS =
  /\b(pac|inc|llc|llp|ltd|corp|corporation|co|company|union|local|committee|cmte|friends|citizens|people|party|democratic|republican|majority|association|assn|council|fund|group|club|bank|partners|foundation|alliance|trust|services|management|federation|league|realtors|engineering|engineers|laborers|workers|carpenters|plumbers|firefighters|teachers|nurses|law|attorneys|associates|holdings|enterprises|properties|development|construction|industries|international|of|for|the)\b|&|\d/i

/** Receipts on D-2 Part 1 (contributions), 2 (transfers in) and 5 (in-kind); not loans or other receipts. */
const CONTRIBUTION_PARTS = /^(1|2|5)/

/**
 * Whether a receipt was filed under the candidate's own name, i.e. money they
 * gave or lent their own committee. ISBE has no receipt type for this (D2Part
 * is 1A individual contributions, 2A transfers in, 3A loans received, 4A other
 * receipts, 5A in-kind), so it goes by name, strictly: the last name must
 * match in full and the given name exactly or as a known nickname ("Chris"
 * doesn't match "Christine", who may be a relative). Names entered whole in
 * the last-name field ("JB Pritzker", "Pritzker, JB") are split first;
 * anything that looks like an organization never matches.
 */
export function isCandidateGiver(
  candidate: ParsedName,
  last: string,
  first: string,
): boolean {
  let l = last.trim()
  let f = first.trim()
  if (!l) return false
  if (!f) {
    if (ORGANIZATION_WORDS.test(l)) return false
    if (l.includes(',')) ({ last: l, first: f } = splitCommaName(l))
    else {
      const words = l.split(/\s+/)
      // A trailing suffix stays with the last name ("Jane Smith Jr").
      const at = /^(jr|sr|ii|iii|iv)\.?$/i.test(words[words.length - 1])
        ? words.length - 2
        : words.length - 1
      if (at < 1) return false
      f = words.slice(0, at).join(' ')
      l = words.slice(at).join(' ')
    }
  }
  return namesMatch(candidate, l, f, { strictGiven: true })
}

export interface CandidateMoney {
  gifts: number
  inKind: number
  loans: number
}

export interface ReceiptSums {
  /** Contributions per report, as sums only; not loans or other receipts. */
  totals: Map<string, { amount: number; count: number }>
  /**
   * Money the candidate gave (Part 1), gave in kind (Part 5) or lent (Part 3)
   * their own committee, per report. Only for reports passed in `candidates`.
   */
  fromCandidate?: Map<string, CandidateMoney>
}

/**
 * One streaming pass over Receipts.txt for the given reports. People's names
 * and addresses are never stored: their receipts only add to the totals.
 * `candidates` (report ID → the candidate the committee belongs to) turns on
 * counting the candidate's own money.
 */
export async function loadReceipts(
  dir: string,
  reportIds: Set<string>,
  candidates: Map<string, ParsedName> = new Map(),
): Promise<ReceiptSums> {
  const totals = new Map<string, { amount: number; count: number }>()
  const fromCandidate = new Map<string, CandidateMoney>()
  await readTsv(join(dir, 'Receipts.txt'), (r) => {
    if (!reportIds.has(r.FiledDocID) || r.Archived === 'True') return
    const amount = Number(r.Amount)
    if (!Number.isFinite(amount)) return
    const candidate = candidates.get(r.FiledDocID)
    if (
      candidate &&
      /^(1|3|5)/.test(r.D2Part) &&
      isCandidateGiver(candidate, r.LastOnlyName, r.FirstName)
    ) {
      const own = fromCandidate.get(r.FiledDocID) ?? {
        gifts: 0,
        inKind: 0,
        loans: 0,
      }
      if (r.D2Part.startsWith('3')) own.loans += amount
      else if (r.D2Part.startsWith('5')) own.inKind += amount
      else own.gifts += amount
      fromCandidate.set(r.FiledDocID, own)
    }
    if (!CONTRIBUTION_PARTS.test(r.D2Part)) return
    const t = totals.get(r.FiledDocID) ?? { amount: 0, count: 0 }
    t.amount += amount
    t.count++
    totals.set(r.FiledDocID, t)
  })
  return { totals, fromCandidate }
}

/** Cents, and undefined unless above zero. */
const positive = (n: number) => (n > 0.005 ? cents(n) : undefined)

/**
 * Large contributions on the given A-1 reports, reported since `since` (the
 * quarterly's end). Undefined when the reports hold no contributions.
 */
export function largeSince(
  since: string,
  a1s: IsbeReport[],
  receipts: Pick<ReceiptSums, 'totals' | 'fromCandidate'>,
): MoneySummary['largeSince'] {
  let total = 0
  let count = 0
  // Gifts and in-kind gifts: loans aren't in `total` (Parts 1, 2 and 5).
  let own = 0
  for (const r of a1s) {
    total += receipts.totals.get(r.id)?.amount ?? 0
    count += receipts.totals.get(r.id)?.count ?? 0
    const mine = receipts.fromCandidate?.get(r.id)
    own += (mine?.gifts ?? 0) + (mine?.inKind ?? 0)
  }
  if (count === 0 || total <= 0) return undefined
  const fromCandidate = positive(own)
  return {
    since,
    total: cents(total),
    count,
    ...(fromCandidate ? { fromCandidate } : {}),
  }
}

/** The joint committee that campaigns for Cook County judges up for retention. */
export const isJudgesRetentionCommittee = (c: IsbeCommittee) =>
  c.shared && /retention of judges/i.test(c.name)

/**
 * A quarterly's summary. `own` is the candidate's own money on it (from
 * loadReceipts). The D-2's total receipts are Parts 1 to 4, so in-kind gifts
 * (Part 5) aren't in `raised` and aren't in `fromCandidate` or the breakdown
 * either. The breakdown follows the D-2's parts, each itemized and not:
 * - small: Part 1 contributions not itemized ($150 or less from a giver in
 *   the period)
 * - large: Part 1 itemized contributions, minus the candidate's own gifts
 * - transfer: Part 2 transfers in from political committees (PACs, parties,
 *   other candidates' committees)
 * - candidate: the candidate's own gifts (Part 1) and loans (Part 3)
 * - loan: Part 3 loans, minus the candidate's
 * - other: Part 4 other receipts
 * Part 1 covers people, businesses and unions alike; the files have no
 * contributor type to tell them apart.
 */
export function isbeSummary(
  committee: IsbeCommittee,
  report: IsbeReport,
  totals: IsbeTotals,
  own?: CandidateMoney,
): MoneySummary {
  const summary: MoneySummary = {
    source: 'ISBE',
    committee: committee.name,
    url: committeeUrl(committee.id),
    period: formatPeriod(report.start, report.end),
    raised: totals.receipts,
    cashOnHand: totals.endFunds,
  }
  const gifts = own?.gifts ?? 0
  const loans = own?.loans ?? 0
  const breakdown = breakdownOf(totals.receipts, {
    small: totals.individualUnitemized,
    large: totals.individualItemized - gifts,
    transfer: totals.transfers,
    candidate: gifts + loans,
    loan: totals.loans - loans,
    other: totals.other,
  })
  if (breakdown) summary.breakdown = breakdown
  const fromCandidate = positive(gifts + loans)
  if (fromCandidate) summary.fromCandidate = fromCandidate
  return summary
}

/** A-1 reports filed for receipts after the quarterly's end. */
export function a1sAfter(
  reports: IsbeReport[],
  committeeId: string,
  after: string,
): IsbeReport[] {
  return reports.filter(
    (r) => r.committeeId === committeeId && r.kind === 'A-1' && r.end > after,
  )
}

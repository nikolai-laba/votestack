// California campaign reports in one shape, whichever system they come from
// (Cal-Access, NetFile, a city's posted PDFs): the Form 460 recipient
// committee statement and the Form 497 late contribution report. Each
// source module fills these; form460Summary turns one into the summary a
// profile shows, with the same breakdown rules as the FEC and ISBE imports.

import type { IsoDate } from '../../../src/shared/ballot.ts'
import type { MoneySummary } from '../../../src/shared/profile.ts'
import { breakdownOf, cents, formatPeriod } from './seats.ts'

/** Schedule A and C contributor codes on the Form 460. */
export type ContributorCode = 'IND' | 'COM' | 'OTH' | 'PTY' | 'SCC'

/** One Form 460 for one reporting period, as filed (the latest amendment). */
export interface Form460 {
  /** The committee's name as filed. */
  committee: string
  /** The FPPC committee ID, when the filing gives one. */
  committeeId?: string
  /** The period the report covers (`from` to `through`). */
  from: IsoDate
  through: IsoDate
  /** When it was filed, if known. */
  filedOn?: IsoDate
  /** Summary page, column A (this period). */
  summary: {
    /** Line 1: monetary contributions (Schedule A). */
    monetary: number
    /** Line 2: loans received less loans repaid this period (Schedule B part 1); can be negative. */
    loans: number
    /** Line 4: nonmonetary (in-kind) contributions (Schedule C). */
    nonmonetary: number
    /** Line 5: total contributions received (1 + 2 + 4). */
    total: number
    /** Line 16: ending cash balance. */
    cashOnHand?: number
  }
  /**
   * Itemized monetary and nonmonetary contributions this period by
   * contributor code (Schedules A and C), when the source has the items.
   */
  byCode?: Partial<Record<ContributorCode, number>>
  /** Unitemized contributions under $100 this period: Schedule A's, plus Schedule C's in-kind ones. */
  unitemized?: number
  /** Contributions (monetary and in-kind) from the candidate this period, matched by name; part of byCode.IND. */
  fromCandidate?: number
  /**
   * Read from a scanned copy of the report (see form460-pdf.ts): by OCR,
   * or by AI with two separate reads that had to agree.
   */
  fromScan?: 'ocr' | 'ai'
  /** Loans from the candidate this period, net of repayments like summary.loans; part of it. */
  loansFromCandidate?: number
}

/** One contribution on a Form 497 late contribution report. */
export interface LateContribution {
  date: IsoDate
  amount: number
  code: ContributorCode
  /** The candidate gave it to their own committee (matched by name). */
  fromCandidate?: boolean
}

/**
 * The summary a profile shows for one Form 460. "Raised" is line 5 (money,
 * loans and in-kind gifts). The breakdown sorts it by contributor code; it's
 * left out when the itemized parts don't add up to line 5, as with ISBE.
 */
export function form460Summary(
  report: Form460,
  where: { filedWith: string; url: string },
): MoneySummary {
  const raised = cents(report.summary.total)
  const own = (report.fromCandidate ?? 0) + (report.loansFromCandidate ?? 0)
  const breakdown =
    report.byCode && report.unitemized !== undefined
      ? breakdownOf(raised, {
          small: report.unitemized,
          large: (report.byCode.IND ?? 0) - (report.fromCandidate ?? 0),
          pac: (report.byCode.COM ?? 0) + (report.byCode.SCC ?? 0),
          party: report.byCode.PTY ?? 0,
          other: report.byCode.OTH ?? 0,
          candidate: own,
          loan: report.summary.loans - (report.loansFromCandidate ?? 0),
        })
      : undefined
  return {
    source: 'CA',
    filedWith: where.filedWith,
    committee: report.committee,
    url: where.url,
    period: formatPeriod(report.from, report.through),
    raised,
    ...(report.summary.cashOnHand !== undefined && {
      cashOnHand: cents(report.summary.cashOnHand),
    }),
    ...(breakdown && breakdown.length > 0 && { breakdown }),
    ...(own > 0 && { fromCandidate: cents(own) }),
    ...(report.fromScan && { fromScan: report.fromScan }),
  }
}

/** Late contributions after the period ended, for `largeSince`; undefined when there are none. */
export function lateSince(
  through: IsoDate,
  late: LateContribution[],
): MoneySummary['largeSince'] {
  const after = late.filter((c) => c.date > through && c.amount > 0)
  if (after.length === 0) return undefined
  const own = after
    .filter((c) => c.fromCandidate)
    .reduce((n, c) => n + c.amount, 0)
  return {
    since: through,
    total: cents(after.reduce((n, c) => n + c.amount, 0)),
    count: after.length,
    ...(own > 0 && { fromCandidate: cents(own) }),
  }
}

/** The latest report: the one covering the latest period, then the latest filed. */
export function latestReport<T extends Form460>(reports: T[]): T | undefined {
  return [...reports].sort(
    (a, b) =>
      b.through.localeCompare(a.through) ||
      (b.filedOn ?? '').localeCompare(a.filedOn ?? ''),
  )[0]
}

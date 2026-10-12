// Which office a ballot contest is for, in the terms the campaign finance
// filings use, plus small helpers shared by the FEC and ISBE imports.

import type { Contest } from '../../../src/shared/ballot.ts'
import {
  MONEY_SOURCE_ORDER,
  type MoneySource,
  type MoneySourceKind,
} from '../../../src/shared/profile.ts'

export type Seat =
  | { level: 'federal'; office: 'S' }
  | { level: 'federal'; office: 'H'; district: number }
  | {
      level: 'state'
      office:
        | 'governor'
        | 'attorney general'
        | 'secretary of state'
        | 'comptroller'
        | 'treasurer'
    }
  | { level: 'state'; office: 'representative' | 'senator'; district: number }
  | {
      level: 'county'
      office:
        | 'board president'
        | 'commissioner'
        | 'board of review'
        | 'assessor'
        | 'clerk'
        | 'sheriff'
        | 'treasurer'
    }
  | { level: 'mwrd' }
  | { level: 'judge'; retention: boolean }
  | { level: 'school board' }

const lastNumber = (id: string) => Number(id.match(/:(\d+)$/)?.[1])

/** The seat a contest fills, from its district and office; null for measures or anything unknown. */
export function seatFor(contest: Contest): Seat | null {
  if (contest.kind === 'measure') return null
  if (contest.kind === 'retention') return { level: 'judge', retention: true }
  const id = contest.districtId
  const office = `${contest.office} ${contest.title}`.toLowerCase()
  if (/\/cd:\d+$/.test(id))
    return { level: 'federal', office: 'H', district: lastNumber(id) }
  if (/\/sldl:\d+$/.test(id))
    return {
      level: 'state',
      office: 'representative',
      district: lastNumber(id),
    }
  if (/\/sldu:\d+$/.test(id))
    return { level: 'state', office: 'senator', district: lastNumber(id) }
  if (/judge/.test(office)) return { level: 'judge', retention: false }
  if (/\/sewer:mwrd$/.test(id)) return { level: 'mwrd' }
  if (/school_board_district|board of education/.test(`${id} ${office}`))
    return { level: 'school board' }
  if (/board_of_review_district/.test(id))
    return { level: 'county', office: 'board of review' }
  if (/council_district/.test(id))
    return { level: 'county', office: 'commissioner' }
  if (/\/state:il$/.test(id)) {
    if (/senator/.test(office)) return { level: 'federal', office: 'S' }
    if (/governor/.test(office)) return { level: 'state', office: 'governor' }
    if (/attorney general/.test(office))
      return { level: 'state', office: 'attorney general' }
    if (/secretary of state/.test(office))
      return { level: 'state', office: 'secretary of state' }
    if (/comptroller/.test(office))
      return { level: 'state', office: 'comptroller' }
    if (/treasurer/.test(office)) return { level: 'state', office: 'treasurer' }
  }
  if (/\/county:cook$/.test(id)) {
    if (/president/.test(office))
      return { level: 'county', office: 'board president' }
    for (const o of ['assessor', 'clerk', 'sheriff', 'treasurer'] as const)
      if (office.includes(o)) return { level: 'county', office: o }
  }
  return null
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

/** "2026-07-01", "2026-09-30" → "July 1 to September 30, 2026" */
export function formatPeriod(start: string, end: string): string {
  const parts = (d: string) => {
    const [y, m, day] = d.slice(0, 10).split('-').map(Number)
    return { y, text: `${MONTHS[m - 1]} ${day}` }
  }
  const a = parts(start)
  const b = parts(end)
  return a.y === b.y
    ? `${a.text} to ${b.text}, ${b.y}`
    : `${a.text}, ${a.y} to ${b.text}, ${b.y}`
}

/** Money rounded to cents. */
export const cents = (n: number) => Math.round(n * 100) / 100

/**
 * Where a report's total came from, by kind of source: the parts in
 * MONEY_SOURCE_ORDER, rounded to cents, with $0 kinds left out. Undefined
 * unless every part is zero or more and they add up to `total` within a
 * dollar (some old or odd reports' parts don't match their total), so the
 * breakdown never shows numbers the report doesn't support.
 */
export function breakdownOf(
  total: number,
  parts: Partial<Record<MoneySourceKind, number>>,
): MoneySource[] | undefined {
  const rows = MONEY_SOURCE_ORDER.flatMap((kind) => {
    const amount = parts[kind]
    return amount === undefined ? [] : [{ kind, amount: cents(amount) }]
  })
  if (rows.some((r) => !Number.isFinite(r.amount) || r.amount < 0))
    return undefined
  const sum = rows.reduce((a, r) => a + r.amount, 0)
  if (!(Math.abs(sum - total) <= 1)) return undefined
  return rows.filter((r) => r.amount > 0)
}

import { describe, expect, it } from 'vitest'
import {
  REPORT_LANDINGS_COUNTED_UNTIL,
  excludeScraper,
} from './usage-exclusions.ts'

const hour = (iso: string) => Date.parse(iso) / 1000
const before = hour('2026-10-21T17:00:00Z')
const after = REPORT_LANDINGS_COUNTED_UNTIL
const zeros = [0, 0, 0, 0, 0, 0, 0]

describe('excludeScraper', () => {
  it('drops report-page landings from before the app stopped counting them', () => {
    const { rows, dropped } = excludeScraper([
      [before, 'view', 'report', 'landing', 'ann-lee', 700, 0, ...zeros, 0],
      [before, 'view', 'report', 'app', 'ann-lee', 2, 0, ...zeros, 0],
      [before, 'view', 'profile', 'landing', 'ann-lee', 40, 0, ...zeros, 0],
      [after, 'view', 'report', 'landing', 'ann-lee', 1, 0, ...zeros, 0],
    ])
    expect(rows.map((r) => [r[2], r[3], r[5]])).toEqual([
      ['report', 'app', 2],
      ['profile', 'landing', 40],
      ['report', 'landing', 1],
    ])
    expect(dropped).toEqual({ views: 700, active: 0 })
  })

  it('takes one no-ballot time count per dropped landing off that hour, with its share of the seconds', () => {
    const { rows, dropped } = excludeScraper([
      [before, 'view', 'report', 'landing', 'ann-lee', 600, 0, ...zeros, 0],
      [before, 'active', '0', '', '', 650, 6500, ...zeros, 0],
      [before, 'active', '1', '', '', 20, 900, ...zeros, 0],
    ])
    expect(rows).toEqual([
      [before, 'active', '0', '', '', 50, 500, ...zeros, 0],
      [before, 'active', '1', '', '', 20, 900, ...zeros, 0],
    ])
    expect(dropped).toEqual({ views: 600, active: 600 })
  })

  it('never takes a time count below zero', () => {
    const { rows } = excludeScraper([
      [before, 'view', 'report', 'landing', 'ann-lee', 9, 0, ...zeros, 0],
      [before, 'active', '0', '', '', 4, 40, ...zeros, 0],
    ])
    expect(rows).toEqual([[before, 'active', '0', '', '', 0, 0, ...zeros, 0]])
  })
})

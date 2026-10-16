import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { form460Summary } from './form460.ts'
import {
  amountsIn,
  isCandidateName,
  layoutOf,
  pageKind,
  parseForm460Ocr,
  parseForm460Text,
  parseForm497Ocr,
  parseForm497Text,
} from './form460-pdf.ts'

// Synthetic statements laid out as pdftotext -layout prints e-filed forms;
// every committee and contributor in them is made up.
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', 'form460', name), 'utf8')
const dana = { first: 'Dana', last: 'Ridgeway' }

describe('parseForm460Text', () => {
  it('reads the cover, Summary Page and schedules of an e-filed statement', () => {
    const r = parseForm460Text(fixture('netfile-460.txt'), dana)
    expect(r).toEqual({
      ok: true,
      value: {
        committee: 'Ridgeway for Harbor Water Board 2026',
        committeeId: '1999001',
        from: '2026-07-01',
        through: '2026-09-19',
        filedOn: '2026-09-24',
        summary: {
          monetary: 4_180.5,
          loans: 2_000,
          nonmonetary: 300,
          total: 6_480.5,
          cashOnHand: 5_012.25,
        },
        byCode: { IND: 1_250, COM: 1_500, OTH: 500, PTY: 300, SCC: 750 },
        unitemized: 180.5,
        fromCandidate: 1_000,
        loansFromCandidate: 2_000,
      },
    })
  })

  it('gives a breakdown that adds up to line 5', () => {
    const r = parseForm460Text(fixture('netfile-460.txt'), dana)
    if (!r.ok) throw new Error(r.reason)
    const s = form460Summary(r.value, { filedWith: 'X', url: 'https://x' })
    expect(s.breakdown).toEqual([
      { kind: 'small', amount: 180.5 },
      { kind: 'large', amount: 250 },
      { kind: 'pac', amount: 2_250 },
      { kind: 'party', amount: 300 },
      { kind: 'candidate', amount: 3_000 },
      { kind: 'other', amount: 500 },
    ])
    expect(s.fromCandidate).toBe(3_000)
  })

  it('reads another program’s layout: mixed-case titles, bare codes, amounts on the next line', () => {
    const r = parseForm460Text(fixture('plain-460.txt'), {
      first: 'Morgan',
      last: 'Vale',
    })
    expect(r).toEqual({
      ok: true,
      value: {
        committee: 'Committee to Elect Morgan Vale 2026',
        from: '2026-01-01',
        through: '2026-06-30',
        summary: {
          monetary: 1_320,
          loans: 0,
          nonmonetary: 0,
          total: 1_320,
          cashOnHand: 845.1,
        },
        byCode: { IND: 700, COM: 400 },
        unitemized: 220,
        fromCandidate: 500,
      },
    })
  })

  it('finds no candidate money without a candidate name', () => {
    const r = parseForm460Text(fixture('netfile-460.txt'))
    expect(r.ok && r.value.fromCandidate).toBeFalsy()
    expect(r.ok && r.value.loansFromCandidate).toBeFalsy()
  })

  it('leaves out the items when they don’t add up to Schedule A', () => {
    const text = fixture('netfile-460.txt').replace('250.00', '260.00')
    const r = parseForm460Text(text, dana)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.summary.total).toBe(6_480.5)
    expect(r.value.byCode).toBeUndefined()
    expect(r.value.unitemized).toBeUndefined()
    expect(r.value.fromCandidate).toBeUndefined()
  })

  it('refuses a Summary Page whose line 5 isn’t lines 1 + 2 + 4', () => {
    const text = fixture('netfile-460.txt').replace(
      '$        6,480.50',
      '$        6,999.50',
    )
    expect(parseForm460Text(text, dana)).toMatchObject({
      ok: false,
      reason: 'unreadable',
    })
  })

  it('says a PDF with no text layer is scanned, and other forms aren’t a 460', () => {
    expect(parseForm460Text('\f \f\n\f')).toEqual({
      ok: false,
      reason: 'scanned',
    })
    expect(
      parseForm460Text(
        'FORM 470\nOfficeholder and Candidate Campaign Statement, Short Form\n'.repeat(
          5,
        ),
      ),
    ).toEqual({ ok: false, reason: 'not-460' })
  })
  it('reads spelled-out codes, two-digit item years, "to" periods and ($) refunds', () => {
    const r = parseForm460Text(fixture('spelled-codes.txt'), dana)
    if (!r.ok) throw new Error(r.reason)
    expect(r.value).toMatchObject({
      committee: 'Ridgeway for Council 2026 - General',
      from: '2026-07-01',
      through: '2026-09-19',
      summary: { monetary: 2050, total: 2350, cashOnHand: 5000 },
      byCode: { IND: 1200, COM: 500, SCC: 200, OTH: 300 },
      unitemized: 150,
      fromCandidate: 1000,
    })
  })
})

describe('parseForm497Text', () => {
  it('reads part 1 only, marking the candidate’s own contribution', () => {
    expect(parseForm497Text(fixture('netfile-497.txt'), dana)).toEqual({
      ok: true,
      value: {
        committee: 'Ridgeway for Harbor Water Board 2026',
        committeeId: '1999001',
        contributions: [
          {
            date: '2026-09-28',
            amount: 5_000,
            code: 'IND',
            fromCandidate: true,
          },
          { date: '2026-10-01', amount: 1_500, code: 'COM' },
        ],
      },
    })
  })

  it('says a scanned report is scanned', () => {
    expect(parseForm497Text('\f\f')).toEqual({ ok: false, reason: 'scanned' })
  })
})

// A scanned statement as OCR lays it out (see layoutOf): made-up committee.
const ocr = fixture('ocr-460.txt')
const edit = (from: string, to: string) => {
  if (!ocr.includes(from)) throw new Error(`fixture has no ${from}`)
  return ocr.replace(from, to)
}
const rejected = (text: string, detail: RegExp) =>
  expect(parseForm460Ocr(text)).toEqual({
    ok: false,
    reason: 'unreadable',
    detail: expect.stringMatching(detail),
  })

describe('parseForm460Ocr', () => {
  it('reads a scan’s Summary Page totals from column A, marked as scanned', () => {
    expect(parseForm460Ocr(ocr)).toEqual({
      ok: true,
      scanned: true,
      value: {
        committee: 'Okafor for Lakeview City Council 2026',
        committeeId: '1499901',
        from: '2026-07-01',
        through: '2026-09-19',
        summary: {
          monetary: 4_180.5,
          loans: 2_000,
          nonmonetary: 300,
          total: 6_480.5,
          cashOnHand: 5_012.25,
        },
      },
    })
  })

  it('reads a blank column A as 0 when line 5 confirms it, never column B', () => {
    // Line 4 blank this period, with an amount in column B only.
    const text = edit('300.00   ', '         ')
      .replace('6,480.50', '6,180.50')
      .replace(
        '2,000.00                                2,000.00',
        '                                        2,000.00',
      )
    const r = parseForm460Ocr(
      text
        .replace('6,180.50', '4,180.50')
        .replace('6,180.50', '4,180.50')
        .replace('6,180.50', '4,180.50')
        .replace('5,012.25', '3,012.25'),
    )
    expect(r.ok && r.value.summary).toEqual({
      monetary: 4_180.5,
      loans: 0,
      nonmonetary: 0,
      total: 4_180.5,
      cashOnHand: 3_012.25,
    })
  })

  it('needs the filer from the caller when the scan’s heading is unreadable', () => {
    const text = edit(
      'Okafor   for   Lakeview   City   Council   2026      ',
      '§ ~|¢ ££   ie   ‘®                              ',
    )
    const r = parseForm460Ocr(text, {
      name: 'Okafor for Lakeview City Council 2026',
    })
    expect(r.ok && r.value.committee).toBe(
      'Okafor for Lakeview City Council 2026',
    )
    expect(parseForm460Ocr(text)).toMatchObject({ ok: false })
  })

  it('rejects a scan whose numbers don’t hold together', () => {
    rejected(edit('6,480.50', '6,430.50'), /line 5 .* isn't lines 1 \+ 2 \+ 4/)
    rejected(edit('6,180.50', '6,130.50'), /line 3 .* isn't lines 1 \+ 2/)
    rejected(
      edit('$ 5,012.25', '$ 5,072.25'),
      /line 16 .* isn't lines 12 \+ 13 \+ 14 - 15/,
    )
    const receipts = ocr.lastIndexOf('6,180.50')
    rejected(
      `${ocr.slice(0, receipts)}6,780.50${ocr.slice(receipts + 8)}`,
      /line 13 .* isn't line 3/,
    )
    rejected(edit('$ 5,012.25', '$ APS2121 '), /no single ending cash balance/)
    rejected(edit('$ 4,180.50', '$ 4,180.50 4.00'), /more than one amount/)
    rejected(
      edit('TOTAL   Column', 'TOTAL   Calumn'.replace('C', '(')),
      /Column A and B headings/,
    )
    rejected(
      edit('CASH   BALANCE', 'CASH   8ALANCE'),
      /lines 2, 4 or 16 not found/,
    )
    rejected(
      edit('Monetary   Contributions', 'Mone7ary   Contributions'),
      /lines 1 or 5 not found/,
    )
  })

  it('takes an unchecked line 16 only when it is printed cleanly', () => {
    // Line 12 unreadable, so lines 12-15 can't check line 16.
    const unchecked = edit('1,250.00', '1,2S0.0O')
    expect(parseForm460Ocr(unchecked).ok).toBe(true)
    rejected(
      unchecked.replace('$ 5,012.25', '$ 5012.25 '),
      /line 16 .* neither checks against lines 12-15 nor reads cleanly/,
    )
  })

  it('rejects a period the two pages don’t agree on, or that isn’t plausible', () => {
    rejected(
      edit('through   09/19/2026', 'through   09/47/2026'),
      /period dates not read cleanly/,
    )
    rejected(
      edit('through   09/19/2026', 'through   09/17/2026'),
      /period dates not read cleanly/,
    )
    rejected(ocr.replaceAll('09/19/2026', '09/19/2020'), /implausible period/)
    rejected(ocr.replaceAll('07/01/2026', '10/01/2026'), /implausible period/)
    // One clean page is enough when the other reads no date at all.
    const r = parseForm460Ocr(edit('through   09/19/2026', 'through   ———'))
    expect(r.ok && r.value.through).toBe('2026-09-19')
  })

  it('prefers the caller’s committee, and takes a scanned ID only when the cover shows it too', () => {
    const r = parseForm460Ocr(ocr, {
      name: 'Okafor for Lakeview',
      id: '1499902',
    })
    expect(r.ok && [r.value.committee, r.value.committeeId]).toEqual([
      'Okafor for Lakeview',
      '1499902',
    ])
    const misread = parseForm460Ocr(edit('1499901', '1499907'))
    expect(misread.ok && misread.value.committeeId).toBeUndefined()
  })

  it('passes a scanned 497 on as not a 460, and says when there is no Summary Page', () => {
    expect(
      parseForm460Ocr('LATE   CONTRIBUTION   REPORT   FORM   497\n'),
    ).toEqual({ ok: false, reason: 'not-460' })
    rejected('§ ~ wiggle ££\f ie ‘® 4\n', /no Summary Page found/)
  })
})

describe('parseForm497Ocr', () => {
  const report = (row2: string) =>
    [
      '497   Contribution   Report                      CALIFORNIA   FORM   497',
      'NAME   OF   FILER                                          I.D.   NUMBER',
      'Okafor   for   Lakeview   City   Council   2026                   1499901',
      '1.   Contribution(s)   Received',
      '10/02/2026      Pat   Example                 X IND        1,000.00',
      row2,
      '2.   Contribution(s)   Made',
      '10/03/2026      Other   Committee             X COM          500.00',
    ].join('\n')

  it('reads part 1 when every row has a clean date, amount and code', () => {
    expect(
      parseForm497Ocr(
        report(
          '10/04/2026      Example   PAC              X COM        2,500.00',
        ),
      ),
    ).toEqual({
      ok: true,
      scanned: true,
      value: {
        committee: 'Okafor for Lakeview City Council 2026',
        committeeId: '1499901',
        contributions: [
          { date: '2026-10-02', amount: 1_000, code: 'IND' },
          { date: '2026-10-04', amount: 2_500, code: 'COM' },
        ],
      },
    })
  })

  it('skips the whole report when one row isn’t clean', () => {
    for (const row of [
      '10/44/2026      Example   PAC              X COM        2,500.00',
      '10/04/2026      Example   PAC              X COM        2,5O0.0',
      '10/04/2026      Example   PAC              [¥) C0M      2,500.00',
      // A lone printed code may be OCR dropping the others beside it.
      '10/04/2026      Example   PAC                COM        2,500.00',
    ])
      expect(parseForm497Ocr(report(row))).toMatchObject({
        ok: false,
        reason: 'unreadable',
      })
  })
})

describe('helpers', () => {
  it('lays out OCR word boxes as rows and columns', () => {
    const word = (x: number, y: number, text: string) =>
      `5\t1\t1\t1\t1\t1\t${x}\t${y}\t${text.length * 20}\t30\t95\t${text}`
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      word(300, 100, 'Monetary'),
      word(1460, 92, '4,180.50'),
      word(470, 104, 'Contributions'),
      word(300, 160, 'Loans'),
      word(1460, 158, '0.00'),
    ].join('\n')
    expect(layoutOf(tsv)).toBe(
      `${' '.repeat(30)}Monetary${' '.repeat(9)}Contributions${' '.repeat(86)}4,180.50\n${' '.repeat(30)}Loans${' '.repeat(111)}0.00`,
    )
  })

  it('reads amounts, not dates, rates or IDs', () => {
    expect(
      amountsIn('07/01/2026  $ 1,234.56  (50.00)  -7.25  0.00 %  ID# 1234567'),
    ).toEqual([1_234.56, -50, -7.25])
  })

  it('matches the candidate’s name strictly', () => {
    expect(isCandidateName('Dana Q. Ridgeway', dana)).toBe(true)
    expect(isCandidateName('Ridgeway, Dana', dana)).toBe(true)
    // A relative with the same last name isn't the candidate.
    expect(isCandidateName('Danielle Ridgeway', dana)).toBe(false)
    expect(isCandidateName('Ridgeway Ridgeway', dana)).toBe(false)
    expect(isCandidateName('Ridgeway Repair LLC', dana)).toBe(false)
    expect(isCandidateName('Dana Ridgeway', undefined)).toBe(false)
  })

  it('tells the parts of the form apart', () => {
    expect(pageKind('Campaign Disclosure Statement     SUMMARY PAGE\n')).toBe(
      'summary',
    )
    expect(pageKind('Schedule B – Part 1      SCHEDULE B - PART 1\n')).toBe(
      'B1',
    )
    expect(
      pageKind('Schedule A (Continuation Sheet)   SCHEDULE A (CONT.)'),
    ).toBe('A')
    expect(
      pageKind('Additional Comments    ADDITIONAL COMMENTS\nSchedule A - note'),
    ).toBe('comments')
  })
})

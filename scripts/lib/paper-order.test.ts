import { describe, expect, it } from 'vitest'
import type { Contest } from '../../src/shared/ballot.ts'
import { ballotText, QuestionMatcher } from './ballot-text.ts'
import {
  agrees,
  chicagoOrder,
  clerkOrder,
  columnOf,
  contestPositions,
  mergeOrders,
  parseBbox,
  ranksOf,
  readingOrder,
  styleOrder,
  withPaperOrder,
} from './paper-order.ts'

/** Lines of text at (x, y) on each page, as `pdftotext -bbox-layout` writes them. */
type Line = [x: number, y: number, text: string]

/** About 4.5 points per character, as in the Clerk's 9 pt type. */
function bbox(pages: Line[][]): string {
  const word = (x: number, y: number, text: string) =>
    `<word xMin="${x}" yMin="${y}.25" xMax="${x + text.length * 4.5}" yMax="${y + 9}">${text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}</word>`
  const line = ([x, y, text]: Line) => {
    let at = x + 0.5
    return text
      .split(' ')
      .map((w) => {
        const out = word(at, y, w)
        at += (w.length + 1) * 4.5
        return out
      })
      .join('\n')
  }
  const page = (lines: Line[]) =>
    `<page width="612.000000" height="1224.000000">\n${lines.map(line).join('\n')}\n</page>`
  return `<doc>\n${pages.map(page).join('\n')}\n</doc>`
}

// A specimen ballot in the Clerk's layout: three columns, so reading by
// height alone would mix them. Di Ng is a candidate on the first card and a
// judge up for retention on the second.
const CARD_A: Line[] = [
  [49, 300, 'United States Senator'],
  [224, 300, 'Judge, 18th Subcircuit (Vacancy of Andreou)'],
  [399, 300, 'Public Questions'],
  [54, 320, '1 Ann Lee'],
  [229, 320, '112 Di Ng'],
  [399, 320, 'To the Voters of Cook County'],
  [54, 340, '2 Bo Diaz'],
  [399, 340, '“Shall Illinois adopt the Millionaire'],
  [399, 352, 'Amendment for property tax relief?”'],
  [224, 360, 'Judge, 18th Subcircuit (Vacancy of Chrones)'],
  [229, 380, '114 Ed Orr'],
  [49, 400, 'Governor'],
  [54, 420, '3 Cy Fox'],
]
const CARD_B: Line[] = [
  [49, 100, 'Ballot for Judicial candidates'],
  [224, 100, 'Fay Poe'],
  [49, 112, 'seeking retention in office.'],
  [49, 150, 'Judicial Retention Circuit Court'],
  [49, 200, 'Di Ng'],
]
const HTML = bbox([CARD_A, CARD_B])
const PLAIN = [...CARD_A, ...CARD_B].map((l) => l[2]).join('\n')

const IL = 'ocd-division/country:us/state:il'
const base = {
  electionId: 'e',
  districtId: IL,
  authorityId: `${IL}/county:cook`,
  sources: [],
  lastVerified: '2026-10-07',
}
const race = (
  id: string,
  title: string,
  ballotOrder: number,
  names: [string, number][],
): Contest => ({
  ...base,
  kind: 'candidate',
  id,
  title,
  office: title,
  voteFor: 1,
  ballotOrder,
  candidates: names.map(([name, n]) => ({ name, ballotOrder: n })),
})
const judge = (id: string, name: string): Contest => ({
  ...base,
  kind: 'retention',
  id,
  title: 'Retention: Judge, Cook County Judicial Circuit',
  office: 'Judge, Cook County Judicial Circuit',
  judge: name,
  ballotOrder: 720001,
})
const question = (id: string, text: string, ballotOrder: number): Contest => ({
  ...base,
  kind: 'measure',
  id,
  title: id,
  question: text,
  ballotOrder,
})

const MILLIONAIRE =
  'Shall Illinois adopt the Millionaire Amendment for property tax relief?'
const contests: Contest[] = [
  // Listed as the Clerk's API does: referenda first, retention judges last.
  question('millionaire', MILLIONAIRE, 1804),
  question('alsip', 'Shall the Village of Alsip modify its term limits?', 1814),
  race('sen', 'Senator, U.S.', 120100, [
    ['Ann Lee', 1],
    ['Bo Diaz', 2],
  ]),
  race('gov', 'Governor', 130030, [['Cy Fox', 3]]),
  // The Clerk numbers these races the other way round from the paper.
  race('chrones', 'Judge, 18th Subcircuit (Chrones)', 341810, [
    ['Ed Orr', 114],
  ]),
  race('andreou', 'Judge, 18th Subcircuit (Andreou)', 341820, [['Di Ng', 112]]),
  race('empty', 'Trustee, Sanitary District', 390102, []),
  judge('ret-di-ng', 'Di Ng'),
  judge('ret-fay-poe', 'Fay Poe'),
]
const matcher = new QuestionMatcher(
  contests.flatMap((c) => (c.kind === 'measure' ? [c.question] : [])),
)

describe('reading a specimen ballot', () => {
  it('assigns words to the column they start in', () => {
    expect([49, 54, 192, 213, 224, 229, 399, 520].map(columnOf)).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2,
    ])
  })

  it('reads page by page, each column top to bottom', () => {
    const words = parseBbox(HTML)
    expect(words[0]).toEqual({
      page: 0,
      x: 49.5,
      y: 300.25,
      text: 'United',
    })
    expect(readingOrder(words).join(' ')).toBe(
      [
        'united states senator 1 ann lee 2 bo diaz governor 3 cy fox',
        'judge 18th subcircuit vacancy of andreou 112 di ng judge 18th subcircuit vacancy of chrones 114 ed orr',
        'public questions to the voters of cook county shall illinois adopt the millionaire amendment for property tax relief',
        'ballot for judicial candidates seeking retention in office judicial retention circuit court di ng',
        'fay poe',
      ].join(' '),
    )
  })

  it('orders the contests on a style as the paper prints them', () => {
    const { positions, unplaced } = contestPositions(
      contests,
      { words: readingOrder(parseBbox(HTML)), ballot: ballotText([PLAIN]) },
      matcher,
    )
    expect(unplaced).toEqual([])
    // Alsip's question isn't on this ballot; a race without candidates can't be found.
    expect(styleOrder(positions)).toEqual([
      'sen',
      'gov',
      'andreou',
      'chrones',
      'millionaire',
      'ret-di-ng',
      'ret-fay-poe',
    ])
  })
})

describe('clerkOrder', () => {
  it('puts races first, then questions, then the retention card', () => {
    expect(clerkOrder(contests).map((c) => c.id)).toEqual([
      'sen',
      'gov',
      'chrones',
      'andreou',
      'empty',
      'millionaire',
      'alsip',
      'ret-di-ng',
      'ret-fay-poe',
    ])
  })

  it('breaks a shared race number by the printed candidate numbers', () => {
    const a = race('a', 'Judge (Fairman)', 341910, [['X', 114]])
    const b = race('b', 'Judge (Kane)', 341910, [['Y', 112]])
    expect(clerkOrder([a, b]).map((c) => c.id)).toEqual(['b', 'a'])
  })
})

describe('mergeOrders', () => {
  const fallback = ['a', 'b', 'c', 'd', 'e']

  it('merges styles that agree into one order, placing the rest by the fallback', () => {
    const { order, conflicts } = mergeOrders(
      [
        ['b', 'a', 'd'],
        ['a', 'c'],
      ],
      fallback,
    )
    expect(order).toEqual(['b', 'a', 'c', 'd', 'e'])
    expect(conflicts).toEqual([])
    expect(agrees(['b', 'a', 'd'], order)).toBe(true)
  })

  it('reports styles that disagree', () => {
    const styles = [
      ['a', 'b'],
      ['b', 'a'],
    ]
    const { order, conflicts } = mergeOrders(styles, fallback)
    expect(conflicts).toHaveLength(1)
    expect(styles.filter((s) => !agrees(s, order))).toHaveLength(1)
  })
})

describe('chicagoOrder', () => {
  const chicago = (c: Contest): Contest => ({
    ...c,
    authorityId: `${IL}/place:chicago`,
  })
  const list = [
    chicago(question('gunshot', 'Restart gunshot detection?', 193)),
    chicago(judge('ret', 'Fay Poe')),
    chicago(race('rep', 'U.S. Representative, 7th District', 13, [])),
    chicago(race('gov', 'Governor & Lieutenant Governor', 2, [])),
    chicago(race('sen', 'United States Senator', 1, [])),
    chicago(race('new', 'Some New Office', 14, [])),
    chicago(race('county', 'County Clerk', 69, [])),
    chicago(
      race('school', 'President of the Chicago Board of Education', 111, []),
    ),
    chicago(race('sub', 'Judge, 1st Subcircuit (Vacancy of Balanoff)', 94, [])),
  ]
  list[1] = { ...list[1], ballotOrder: 132 }

  it('follows the Board list and the office order of Illinois law', () => {
    const { order, unmatched } = chicagoOrder(list)
    expect(order.map((c) => c.id)).toEqual([
      'sen',
      'gov',
      'rep',
      'new',
      'county',
      'sub',
      'school',
      'ret',
      'gunshot',
    ])
    expect(unmatched).toEqual(['Some New Office'])
  })

  it('moves a race the list puts out of the law’s order', () => {
    const early = { ...list[6], ballotOrder: 0.5 } // County Clerk listed first
    const { order } = chicagoOrder([early, ...list.slice(2, 5)])
    expect(order.map((c) => c.id)).toEqual(['sen', 'gov', 'rep', 'county'])
  })
})

describe('withPaperOrder', () => {
  it('adds the rank to the contests that have one', () => {
    const ranks = ranksOf(['gov', 'sen'])
    expect(ranks).toEqual({ gov: 1, sen: 2 })
    const [sen, gov, empty] = withPaperOrder(
      [contests[2], contests[3], contests[6]],
      ranks,
    )
    expect(sen.paperOrder).toBe(2)
    expect(gov.paperOrder).toBe(1)
    expect(empty).not.toHaveProperty('paperOrder')
  })
})
